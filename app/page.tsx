"use client"

import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { tokenize, type TextToken } from "@/lib/tokenizer"
import { matchSpeechToScript } from "@/lib/speech-matcher"
import {
  parseMarkdownBlocks,
  stripMarkdownForTokenizer,
  type InlineChunk,
  type MarkdownBlock,
} from "@/lib/markdown"

// ─── Types ───────────────────────────────────────────────────────────────────

type AsrMode = "webspeech" | "whisper"
type AppMode = "edit" | "prompter"
type WhisperStatus = "idle" | "loading" | "ready"

type ProgressItem = { file: string; progress: number; total: number }

type Settings = {
  fontSize: number
  fontFamily: string
  fontWeight: string
  zoom: number
  scrollOffset: number
}

type SavedScript = {
  id: string
  name: string
  content: string
  savedAt: number
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DRAFT_KEY = "yomi:draft"
const SCRIPTS_KEY = "yomi:scripts"

const SAMPLE_SCRIPT = `# Welcome to Yomi

Replace this text with your own script. The teleprompter will automatically scroll as you speak, highlighting words you have already said.

To get started, click **Edit** to paste your content, then click **Prompter** and press the microphone button to begin. The text will follow your voice in *real time*.

You can adjust font size, style, and zoom using the controls in the toolbar above.`

const FONT_FAMILIES = [
  { label: "Sans", value: "ui-sans-serif, system-ui, sans-serif" },
  { label: "Serif", value: "Georgia, serif" },
  { label: "Mono", value: "ui-monospace, monospace" },
  { label: "Courier", value: "'Courier New', Courier, monospace" },
]

const FONT_WEIGHTS = [
  { label: "Light", value: "300" },
  { label: "Regular", value: "400" },
  { label: "Medium", value: "500" },
  { label: "SemiBold", value: "600" },
  { label: "Bold", value: "700" },
]

const WHISPER_SAMPLE_RATE = 16_000
const MAX_AUDIO_SAMPLES = WHISPER_SAMPLE_RATE * 30

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadSavedScripts(): SavedScript[] {
  try {
    return JSON.parse(localStorage.getItem(SCRIPTS_KEY) ?? "[]")
  } catch {
    return []
  }
}

function saveSavedScripts(scripts: SavedScript[]) {
  localStorage.setItem(SCRIPTS_KEY, JSON.stringify(scripts))
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function YomiPage() {
  // ── App state ───────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<AppMode>("edit")
  const [script, setScript] = useState(SAMPLE_SCRIPT)
  const [markdownEnabled, setMarkdownEnabled] = useState(true)
  const [currentIndex, setCurrentIndex] = useState(-1)
  const [interimIndex, setInterimIndex] = useState(-1)

  const tokens = useMemo(
    () => tokenize(markdownEnabled ? stripMarkdownForTokenizer(script) : script),
    [script, markdownEnabled],
  )

  // ── Settings ────────────────────────────────────────────────────────────────
  const [settings, setSettings] = useState<Settings>({
    fontSize: 48,
    fontFamily: FONT_FAMILIES[0].value,
    fontWeight: "500",
    zoom: 100,
    scrollOffset: 120,
  })

  // ── ASR state ────────────────────────────────────────────────────────────────
  const [asrMode, setAsrMode] = useState<AsrMode>("webspeech")
  const [isListening, setIsListening] = useState(false)
  const [isWebGPUAvailable, setIsWebGPUAvailable] = useState(false)

  useEffect(() => {
    setIsWebGPUAvailable(typeof navigator !== "undefined" && "gpu" in navigator)
  }, [])

  // ── Whisper state ────────────────────────────────────────────────────────────
  const [whisperStatus, setWhisperStatus] = useState<WhisperStatus>("idle")
  const [loadingMessage, setLoadingMessage] = useState("")
  const [progressItems, setProgressItems] = useState<ProgressItem[]>([])

  // ── localStorage: scripts panel ─────────────────────────────────────────────
  const [savedScripts, setSavedScripts] = useState<SavedScript[]>([])
  const [saveScriptName, setSaveScriptName] = useState("")
  const [scriptsOpen, setScriptsOpen] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)

  // Load from localStorage on mount
  useEffect(() => {
    const draft = localStorage.getItem(DRAFT_KEY)
    if (draft) setScript(draft)
    setSavedScripts(loadSavedScripts())
  }, [])

  // Auto-save draft with debounce
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
    draftTimerRef.current = setTimeout(() => {
      localStorage.setItem(DRAFT_KEY, script)
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1200)
    }, 600)
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
    }
  }, [script])

  const handleSaveScript = useCallback(() => {
    const name = saveScriptName.trim() || `Script ${new Date().toLocaleDateString()}`
    const entry: SavedScript = { id: `${Date.now()}`, name, content: script, savedAt: Date.now() }
    const updated = [entry, ...savedScripts]
    setSavedScripts(updated)
    saveSavedScripts(updated)
    setSaveScriptName("")
  }, [saveScriptName, script, savedScripts])

  const handleLoadScript = useCallback(
    (s: SavedScript) => {
      setScript(s.content)
      setCurrentIndex(-1)
      setInterimIndex(-1)
      finalBufferRef.current = ""
      lastIndexRef.current = -1
      setScriptsOpen(false)
    },
    [],
  )

  const handleDeleteScript = useCallback(
    (id: string) => {
      const updated = savedScripts.filter((s) => s.id !== id)
      setSavedScripts(updated)
      saveSavedScripts(updated)
    },
    [savedScripts],
  )

  // ── Refs ─────────────────────────────────────────────────────────────────────
  const contentRef = useRef<HTMLDivElement>(null)
  const currentWordRef = useRef<HTMLSpanElement>(null)
  const bottomSpacerRef = useRef<HTMLDivElement>(null)
  const speechRecRef = useRef<InstanceType<typeof SpeechRecognition> | null>(null)
  const shouldListenRef = useRef(false)
  const finalBufferRef = useRef("")
  const workerRef = useRef<Worker | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const isProcessingRef = useRef(false)
  const streamRef = useRef<MediaStream | null>(null)
  const lastIndexRef = useRef(-1)

  useEffect(() => {
    lastIndexRef.current = currentIndex
  }, [currentIndex])

  // ── Scroll to current word ────────────────────────────────────────────────────
  // FIX: position:relative on container makes offsetTop relative to it, not the page.
  // FIX: zoom is now handled via font-size multiplication, so coordinates are never mismatched.

  useLayoutEffect(() => {
    const container = contentRef.current
    const el = currentWordRef.current
    if (!container) return
    if (el) {
      container.scrollTo({
        top: Math.max(el.offsetTop - settings.scrollOffset, 0),
        behavior: "smooth",
      })
    } else {
      container.scrollTo({ top: 0, behavior: "smooth" })
    }
  }, [interimIndex, currentIndex, settings.scrollOffset])

  useLayoutEffect(() => {
    const container = contentRef.current
    const spacer = bottomSpacerRef.current
    if (!container || !spacer) return
    spacer.style.height = `${settings.scrollOffset + container.clientHeight}px`
  }, [settings.scrollOffset, tokens.length])

  // ── Speech → position ────────────────────────────────────────────────────────

  const onTranscript = useCallback(
    (text: string, isFinal: boolean) => {
      const refIndex = isFinal ? lastIndexRef.current : currentIndex
      const idx = matchSpeechToScript(text, tokens, Math.max(0, refIndex))
      if (isFinal) {
        setCurrentIndex(idx)
        setInterimIndex(idx)
        finalBufferRef.current = text
        lastIndexRef.current = idx
      } else {
        setInterimIndex(idx)
      }
    },
    [tokens, currentIndex],
  )

  // ── Web Speech API ────────────────────────────────────────────────────────────

  const startWebSpeech = useCallback(() => {
    const SpeechRec =
      typeof window !== "undefined"
        ? window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
        : null
    if (!SpeechRec) {
      alert("Web Speech API not supported. Try Chrome or Edge.")
      return
    }
    speechRecRef.current?.abort()
    const rec = new SpeechRec()
    rec.lang = "en-US"
    rec.continuous = true
    rec.interimResults = true
    rec.onresult = (e: SpeechRecognitionEvent) => {
      let interim = ""
      let finals = ""
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) finals += r[0].transcript + " "
        else interim += r[0].transcript
      }
      if (finals) {
        finalBufferRef.current += " " + finals
        if (finalBufferRef.current.length > 200) finalBufferRef.current = finalBufferRef.current.slice(-200)
        onTranscript(finalBufferRef.current.trim(), true)
      }
      if (interim) onTranscript((finalBufferRef.current + " " + interim).trim(), false)
    }
    rec.onend = () => {
      if (shouldListenRef.current) try { rec.start() } catch { /* already starting */ }
    }
    rec.onerror = (e: SpeechRecognitionErrorEvent) => {
      if (e.error !== "aborted" && e.error !== "no-speech") console.warn("Speech error:", e.error)
    }
    speechRecRef.current = rec
    shouldListenRef.current = true
    rec.start()
    setIsListening(true)
  }, [onTranscript])

  const stopWebSpeech = useCallback(() => {
    shouldListenRef.current = false
    speechRecRef.current?.abort()
    speechRecRef.current = null
    setIsListening(false)
  }, [])

  // ── Whisper ───────────────────────────────────────────────────────────────────

  const initWhisperWorker = useCallback(() => {
    if (workerRef.current) return
    const worker = new Worker(new URL("../lib/whisper-worker.ts", import.meta.url), { type: "module" })
    workerRef.current = worker
    worker.onmessage = (e) => {
      const { status, data, file, progress, total, output } = e.data
      switch (status) {
        case "loading":
          setWhisperStatus("loading")
          setLoadingMessage(data)
          break
        case "initiate":
          setProgressItems((prev) =>
            prev.some((p) => p.file === file) ? prev : [...prev, { file, progress: 0, total: 0 }],
          )
          break
        case "progress":
          setProgressItems((prev) =>
            prev.map((p) => (p.file === file ? { ...p, progress, total } : p)),
          )
          break
        case "done":
          setProgressItems((prev) => prev.filter((p) => p.file !== file))
          break
        case "ready":
          setWhisperStatus("ready")
          break
        case "complete":
          if (output?.[0]) {
            finalBufferRef.current += " " + output[0]
            if (finalBufferRef.current.length > 300) finalBufferRef.current = finalBufferRef.current.slice(-300)
            onTranscript(finalBufferRef.current.trim(), true)
          }
          isProcessingRef.current = false
          processNextChunk()
          break
      }
    }
  }, [onTranscript]) // eslint-disable-line react-hooks/exhaustive-deps

  const processNextChunk = useCallback(() => {
    if (isProcessingRef.current) return
    if (!recorderRef.current || chunksRef.current.length === 0) {
      recorderRef.current?.requestData()
      return
    }
    isProcessingRef.current = true
    const blob = new Blob(chunksRef.current, { type: recorderRef.current.mimeType })
    chunksRef.current = []
    const reader = new FileReader()
    reader.onloadend = async () => {
      if (!audioCtxRef.current || !workerRef.current) return
      const buf = await audioCtxRef.current.decodeAudioData(reader.result as ArrayBuffer)
      let audio = buf.getChannelData(0)
      if (audio.length > MAX_AUDIO_SAMPLES) audio = audio.slice(-MAX_AUDIO_SAMPLES)
      workerRef.current.postMessage({ type: "generate", data: { audio, language: "en" } })
    }
    reader.readAsArrayBuffer(blob)
  }, [])

  const startWhisper = useCallback(async () => {
    initWhisperWorker()
    if (whisperStatus === "idle") {
      workerRef.current?.postMessage({ type: "load" })
      setWhisperStatus("loading")
      return
    }
    if (whisperStatus !== "ready") return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      audioCtxRef.current = new AudioContext({ sampleRate: WHISPER_SAMPLE_RATE })
      const recorder = new MediaRecorder(stream)
      recorderRef.current = recorder
      chunksRef.current = []
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = () => setIsListening(false)
      recorder.start(3000)
      shouldListenRef.current = true
      setIsListening(true)
      const loop = () => { if (shouldListenRef.current) { processNextChunk(); setTimeout(loop, 3000) } }
      setTimeout(loop, 3000)
    } catch (err) {
      console.error("Mic access denied:", err)
    }
  }, [whisperStatus, initWhisperWorker, processNextChunk])

  const stopWhisper = useCallback(() => {
    shouldListenRef.current = false
    recorderRef.current?.stop()
    recorderRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setIsListening(false)
  }, [])

  const toggleMic = useCallback(() => {
    if (isListening) {
      if (asrMode === "webspeech") stopWebSpeech()
      else stopWhisper()
    } else {
      finalBufferRef.current = ""
      if (asrMode === "webspeech") startWebSpeech()
      else startWhisper()
    }
  }, [isListening, asrMode, startWebSpeech, stopWebSpeech, startWhisper, stopWhisper])

  // ── Keyboard shortcuts ───────────────────────────────────────────────────────

  useEffect(() => {
    if (mode !== "prompter") return
    const refTokens = tokens.filter((t) => t.type === "TOKEN")
    const max = refTokens.length > 0 ? refTokens[refTokens.length - 1].index : 0
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space") { e.preventDefault(); toggleMic() }
      else if (e.code === "ArrowUp") { e.preventDefault(); setCurrentIndex((i) => Math.max(-1, i - 15)); setInterimIndex((i) => Math.max(-1, i - 15)) }
      else if (e.code === "ArrowDown") { e.preventDefault(); setCurrentIndex((i) => Math.min(max, i + 15)); setInterimIndex((i) => Math.min(max, i + 15)) }
      else if (e.code === "ArrowLeft") { e.preventDefault(); setCurrentIndex((i) => Math.max(-1, i - 5)); setInterimIndex((i) => Math.max(-1, i - 5)) }
      else if (e.code === "ArrowRight") { e.preventDefault(); setCurrentIndex((i) => Math.min(max, i + 5)); setInterimIndex((i) => Math.min(max, i + 5)) }
      else if (e.code === "Escape") { e.preventDefault(); if (isListening) toggleMic(); setMode("edit") }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [mode, tokens, toggleMic, isListening])

  useEffect(() => {
    if (mode === "edit" && isListening) {
      if (asrMode === "webspeech") stopWebSpeech()
      else stopWhisper()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const updateSetting = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setSettings((s) => ({ ...s, [key]: value }))

  const activeIndex = interimIndex >= 0 ? interimIndex : currentIndex

  // The effective font size accounts for zoom directly (no CSS zoom on the container)
  const effectiveFontSize = settings.fontSize * (settings.zoom / 100)

  const wordCount = tokens.filter((t) => t.type === "TOKEN").length
  const spokenCount = tokens.filter((t) => t.type === "TOKEN" && t.index <= currentIndex + 1).length

  // ── Markdown rendering helpers ────────────────────────────────────────────────

  const wordTokens = useMemo(() => tokens.filter((t) => t.type === "TOKEN"), [tokens])

  // Sequential word position counter — reset before each markdown render pass
  const mdWordPosRef = useRef(0)

  function renderWord(word: string, pos: number, key: string | number): ReactNode {
    const tokenEntry = wordTokens[pos]
    const tokenIdx = tokenEntry?.index ?? pos * 2
    const isSpoken = currentIndex >= 0 && tokenIdx <= currentIndex + 1
    const isInterim = !isSpoken && interimIndex >= 0 && tokenIdx <= interimIndex + 1
    const isCurrent =
      (activeIndex < 0 && pos === 0) ||
      (activeIndex >= 0 && tokenIdx === activeIndex + 1)
    return (
      <span
        key={key}
        ref={isCurrent ? currentWordRef : undefined}
        className={cn(
          "cursor-pointer transition-colors duration-150",
          isSpoken ? "text-muted-foreground/40" : isInterim ? "text-muted-foreground" : "text-foreground",
          isCurrent && "rounded px-0.5 ring-2 ring-primary/60 bg-primary/10",
        )}
        onClick={() => {
          const idx = (tokenEntry?.index ?? pos * 2) - 1
          setCurrentIndex(idx)
          setInterimIndex(idx)
          lastIndexRef.current = idx
        }}
      >
        {word}
      </span>
    )
  }

  function renderChunks(chunks: InlineChunk[]): ReactNode {
    return chunks.map((chunk, ci) => {
      const toks = tokenize(chunk.text)
      const parts = toks.map((tok, ti) => {
        if (tok.type === "DELIMITER") return tok.value
        const pos = mdWordPosRef.current++
        return renderWord(tok.value, pos, `${ci}-${ti}`)
      })
      if (!chunk.bold && !chunk.italic) return <span key={ci}>{parts}</span>
      if (chunk.bold && chunk.italic) return <strong key={ci}><em>{parts}</em></strong>
      if (chunk.bold) return <strong key={ci}>{parts}</strong>
      return <em key={ci}>{parts}</em>
    })
  }

  function renderMarkdownBlocks(blocks: MarkdownBlock[]): ReactNode {
    return blocks.map((block, bi) => {
      if (block.kind === "blank") return <div key={bi} style={{ height: "0.6em" }} />
      if (block.kind === "heading") {
        const scaleFactor = block.level === 1 ? 1.5 : block.level === 2 ? 1.25 : 1.1
        return (
          <div
            key={bi}
            style={{ fontSize: effectiveFontSize * scaleFactor, fontWeight: "700", marginBottom: "0.4em" }}
          >
            {renderChunks(block.chunks)}
          </div>
        )
      }
      return (
        <p key={bi} style={{ marginBottom: "0.8em" }}>
          {renderChunks(block.chunks)}
        </p>
      )
    })
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const markdownBlocks = useMemo(
    () => (markdownEnabled ? parseMarkdownBlocks(script) : null),
    [script, markdownEnabled],
  )

  // Reset markdown word counter before render — this must happen synchronously
  // before the JSX tree is built (React renders synchronously in the same tick)
  mdWordPosRef.current = 0

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col bg-background text-foreground">
        {/* ── Toolbar ── */}
        <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
          <span className="text-sm font-semibold tracking-tight">Yomi</span>

          <Separator orientation="vertical" className="h-5" />

          {/* Edit / Prompter */}
          <div className="flex rounded-md border">
            <Button
              size="sm"
              variant={mode === "edit" ? "default" : "ghost"}
              className="rounded-r-none border-0 text-xs h-7 px-3"
              onClick={() => {
                if (isListening) toggleMic()
                setMode("edit")
                setCurrentIndex(-1)
                setInterimIndex(-1)
              }}
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant={mode === "prompter" ? "default" : "ghost"}
              className="rounded-l-none border-0 text-xs h-7 px-3"
              onClick={() => setMode("prompter")}
            >
              Prompter
            </Button>
          </div>

          <Separator orientation="vertical" className="h-5" />

          {/* Font family */}
          <div className="flex items-center gap-1.5">
            <Label className="text-xs text-muted-foreground">Font</Label>
            <div className="flex rounded-md border">
              {FONT_FAMILIES.map((f) => (
                <Button
                  key={f.value}
                  size="sm"
                  variant={settings.fontFamily === f.value ? "default" : "ghost"}
                  className="h-7 rounded-none border-0 px-2 text-xs first:rounded-l-md last:rounded-r-md"
                  style={{ fontFamily: f.value }}
                  onClick={() => updateSetting("fontFamily", f.value)}
                >
                  {f.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Font weight */}
          <div className="flex items-center gap-1.5">
            <Label className="text-xs text-muted-foreground">Weight</Label>
            <div className="flex rounded-md border">
              {FONT_WEIGHTS.map((w) => (
                <Button
                  key={w.value}
                  size="sm"
                  variant={settings.fontWeight === w.value ? "default" : "ghost"}
                  className="h-7 rounded-none border-0 px-2 text-xs first:rounded-l-md last:rounded-r-md"
                  style={{ fontWeight: w.value }}
                  onClick={() => updateSetting("fontWeight", w.value)}
                >
                  {w.label}
                </Button>
              ))}
            </div>
          </div>

          <Separator orientation="vertical" className="h-5" />

          {/* Size */}
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground w-16">Size {settings.fontSize}px</Label>
            <Slider
              min={16} max={120} step={2}
              value={[settings.fontSize]}
              onValueChange={(v) => updateSetting("fontSize", Array.isArray(v) ? v[0] : v)}
              className="w-24"
            />
          </div>

          {/* Zoom */}
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground w-14">Zoom {settings.zoom}%</Label>
            <Slider
              min={50} max={200} step={5}
              value={[settings.zoom]}
              onValueChange={(v) => updateSetting("zoom", Array.isArray(v) ? v[0] : v)}
              className="w-24"
            />
          </div>

          {/* Scroll offset */}
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground w-[4.5rem]">Offset {settings.scrollOffset}px</Label>
            <Slider
              min={0} max={400} step={10}
              value={[settings.scrollOffset]}
              onValueChange={(v) => updateSetting("scrollOffset", Array.isArray(v) ? v[0] : v)}
              className="w-24"
            />
          </div>

          <Separator orientation="vertical" className="h-5" />

          {/* Markdown toggle */}
          <div className="flex items-center gap-1.5">
            <Tooltip>
              <TooltipTrigger>
                <Label className="text-xs cursor-pointer" htmlFor="md-toggle">MD</Label>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                Render markdown formatting (bold, italic, headings)
              </TooltipContent>
            </Tooltip>
            <Switch
              id="md-toggle"
              checked={markdownEnabled}
              onCheckedChange={setMarkdownEnabled}
            />
          </div>

          <Separator orientation="vertical" className="h-5" />

          {/* Scripts popover */}
          <Popover open={scriptsOpen} onOpenChange={setScriptsOpen}>
            <PopoverTrigger className="inline-flex h-7 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs shadow-xs hover:bg-accent hover:text-accent-foreground">
              Scripts
              {savedScripts.length > 0 && (
                <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                  {savedScripts.length}
                </Badge>
              )}
            </PopoverTrigger>
            <PopoverContent className="w-72 p-3" align="end">
              <p className="text-xs font-medium mb-2">Save current script</p>
              <div className="flex gap-1.5 mb-3">
                <Input
                  placeholder="Script name..."
                  className="h-7 text-xs"
                  value={saveScriptName}
                  onChange={(e) => setSaveScriptName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSaveScript() }}
                />
                <Button size="sm" className="h-7 text-xs shrink-0" onClick={handleSaveScript}>
                  Save
                </Button>
              </div>
              {savedScripts.length > 0 ? (
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {savedScripts.map((s) => (
                    <div key={s.id} className="flex items-center gap-1.5 rounded-md p-1.5 hover:bg-muted/50">
                      <button
                        className="flex-1 text-left text-xs truncate"
                        onClick={() => handleLoadScript(s)}
                      >
                        <span className="font-medium">{s.name}</span>
                        <span className="text-muted-foreground ml-1.5">
                          {new Date(s.savedAt).toLocaleDateString()}
                        </span>
                      </button>
                      <button
                        className="text-muted-foreground hover:text-foreground text-xs px-1"
                        onClick={() => handleDeleteScript(s.id)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No saved scripts yet.</p>
              )}
            </PopoverContent>
          </Popover>

          <Separator orientation="vertical" className="h-5" />

          {/* ASR mode */}
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger>
                <Label className="text-xs cursor-pointer" htmlFor="asr-toggle">Web Speech</Label>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs text-xs">
                Cloud-based (Google). Chrome/Edge only. Audio is sent to Google servers.
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger>
                <div>
                  <Switch
                    id="asr-toggle"
                    checked={asrMode === "whisper"}
                    disabled={!isWebGPUAvailable}
                    onCheckedChange={(checked) => {
                      if (isListening) toggleMic()
                      setAsrMode(checked ? "whisper" : "webspeech")
                    }}
                  />
                </div>
              </TooltipTrigger>
              {!isWebGPUAvailable && (
                <TooltipContent side="bottom" className="text-xs">
                  WebGPU not available. Whisper requires Chrome 113+ on desktop.
                </TooltipContent>
              )}
            </Tooltip>
            <Tooltip>
              <TooltipTrigger>
                <Label className="text-xs cursor-pointer" htmlFor="asr-toggle">Whisper</Label>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs text-xs">
                Local AI — audio never leaves your device. Requires WebGPU. ~200MB download on first use.
              </TooltipContent>
            </Tooltip>
            {asrMode === "whisper" && whisperStatus !== "ready" && (
              <Button
                size="sm" variant="outline" className="h-7 text-xs"
                disabled={whisperStatus === "loading"}
                onClick={() => {
                  initWhisperWorker()
                  workerRef.current?.postMessage({ type: "load" })
                  setWhisperStatus("loading")
                }}
              >
                {whisperStatus === "loading" ? "Loading..." : "Load model"}
              </Button>
            )}
          </div>
        </header>

        {/* ── Whisper progress ── */}
        {whisperStatus === "loading" && (
          <div className="border-b bg-muted/50 px-4 py-2 text-xs">
            <p className="mb-1 text-muted-foreground">{loadingMessage}</p>
            {progressItems.map((item, i) => (
              <div key={`${item.file}-${i}`} className="mb-1">
                <div className="flex justify-between text-muted-foreground mb-0.5">
                  <span className="truncate max-w-xs">{item.file}</span>
                  <span>
                    {item.total
                      ? `${(item.progress / 1e6).toFixed(1)} / ${(item.total / 1e6).toFixed(1)} MB`
                      : `${(item.progress / 1e6).toFixed(1)} MB`}
                  </span>
                </div>
                <div className="h-1 w-full rounded-full bg-muted">
                  <div
                    className="h-1 rounded-full bg-primary transition-all"
                    style={{ width: item.total ? `${(item.progress / item.total) * 100}%` : "0%" }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Content area ── */}
        <main className="relative flex-1 overflow-hidden">
          {mode === "edit" ? (
            <Textarea
              className="h-full w-full resize-none rounded-none border-0 bg-background p-6 text-sm focus-visible:ring-0"
              value={script}
              onChange={(e) => setScript(e.target.value)}
              placeholder="Paste your script here... Markdown is supported."
            />
          ) : (
            // FIX: position:relative ensures el.offsetTop is relative to this container
            // FIX: no CSS zoom — effectiveFontSize = fontSize * zoom/100
            <div
              ref={contentRef}
              className="h-full overflow-y-auto px-8 py-6 select-none"
              style={{ position: "relative" }}
            >
              <div
                style={{
                  fontFamily: settings.fontFamily,
                  fontWeight: settings.fontWeight,
                  lineHeight: 1.6,
                  fontSize: effectiveFontSize,
                  maxWidth: "100%",
                }}
              >
                {markdownEnabled && markdownBlocks ? (
                  renderMarkdownBlocks(markdownBlocks)
                ) : (
                  tokens.map((token, idx) => {
                    const isSpoken = currentIndex >= 0 && token.index <= currentIndex + 1
                    const isInterim = !isSpoken && interimIndex >= 0 && token.index <= interimIndex + 1
                    const isCurrent =
                      token.type === "TOKEN" &&
                      (token.index === activeIndex + 1 || (activeIndex < 0 && idx === 0))
                    return (
                      <span
                        key={`${token.index}-${idx}`}
                        ref={isCurrent ? currentWordRef : undefined}
                        className={cn(
                          "cursor-pointer transition-colors duration-150",
                          isSpoken ? "text-muted-foreground/40" : isInterim ? "text-muted-foreground" : "text-foreground",
                          isCurrent && "rounded px-0.5 ring-2 ring-primary/60 bg-primary/10",
                        )}
                        onClick={() => {
                          setCurrentIndex(token.index - 1)
                          setInterimIndex(token.index - 1)
                          lastIndexRef.current = token.index - 1
                        }}
                      >
                        {token.value.split("\n").map((part, i, arr) => (
                          <span key={i}>{part}{i < arr.length - 1 && <br />}</span>
                        ))}
                      </span>
                    )
                  })
                )}
                <div ref={bottomSpacerRef} aria-hidden="true" style={{ height: 0, flexShrink: 0 }} />
              </div>
            </div>
          )}

          {/* ── Mic button ── */}
          {mode === "prompter" && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2">
              <Button
                size="lg"
                variant={isListening ? "destructive" : "default"}
                className="h-14 w-14 rounded-full shadow-lg"
                title={isListening ? "Stop listening (Space)" : "Start listening (Space)"}
                onClick={toggleMic}
                disabled={asrMode === "whisper" && whisperStatus !== "ready"}
              >
                {isListening ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" stroke="none" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" />
                  </svg>
                )}
              </Button>
              {isListening && (
                <Badge variant="secondary" className="animate-pulse text-xs">
                  {asrMode === "whisper" ? "Whisper" : "Web Speech"} · Listening
                </Badge>
              )}
            </div>
          )}
        </main>

        {/* ── Status bar ── */}
        <footer className="flex items-center gap-3 border-t px-4 py-1.5 text-xs text-muted-foreground">
          <span>{wordCount} words</span>
          <Separator orientation="vertical" className="h-3" />
          <span>
            {currentIndex >= 0 ? `${spokenCount} / ${wordCount} spoken` : "Position: start"}
          </span>
          {savedFlash && (
            <>
              <Separator orientation="vertical" className="h-3" />
              <span className="text-green-500">Saved</span>
            </>
          )}
          <Separator orientation="vertical" className="h-3" />
          <span className="ml-auto">
            {mode === "prompter" && "Space = mic · Arrows = navigate · Esc = edit"}
          </span>
        </footer>
      </div>
    </TooltipProvider>
  )
}
