// Speech Recognition Web API types (webkit prefix for Chrome/Safari)
declare class SpeechRecognition extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onend: (() => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  start(): void
  stop(): void
  abort(): void
}

declare interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number
  readonly results: SpeechRecognitionResultList
}

declare interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string
  readonly message: string
}

interface Window {
  SpeechRecognition: typeof SpeechRecognition
  webkitSpeechRecognition: typeof SpeechRecognition
}
