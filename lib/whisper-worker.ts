import {
  AutoTokenizer,
  AutoProcessor,
  WhisperForConditionalGeneration,
  TextStreamer,
  full,
} from "@huggingface/transformers"

const MODEL_ID = "onnx-community/whisper-base"
const MAX_NEW_TOKENS = 64

class ASRPipeline {
  static tokenizer: ReturnType<typeof AutoTokenizer.from_pretrained> | null = null
  static processor: ReturnType<typeof AutoProcessor.from_pretrained> | null = null
  static model: ReturnType<typeof WhisperForConditionalGeneration.from_pretrained> | null = null

  static async getInstance(progress_callback?: (x: unknown) => void) {
    if (!this.tokenizer) {
      this.tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, { progress_callback })
    }
    if (!this.processor) {
      this.processor = AutoProcessor.from_pretrained(MODEL_ID, { progress_callback })
    }
    if (!this.model) {
      this.model = WhisperForConditionalGeneration.from_pretrained(MODEL_ID, {
        dtype: { encoder_model: "fp32", decoder_model_merged: "q4" },
        device: "webgpu",
        progress_callback,
      })
    }
    return Promise.all([this.tokenizer, this.processor, this.model])
  }
}

let processing = false

async function generate({ audio, language }: { audio: Float32Array; language: string }) {
  if (processing) return
  processing = true
  self.postMessage({ status: "start" })

  const [tokenizer, processor, model] = await ASRPipeline.getInstance()

  let numTokens = 0
  let startTime = 0

  const streamer = new TextStreamer(tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    token_callback_function: () => {
      if (!startTime) startTime = performance.now()
      numTokens++
    },
    callback_function: (output: string) => {
      const tps = numTokens > 0 ? (numTokens / (performance.now() - startTime)) * 1000 : 0
      self.postMessage({ status: "update", output, tps, numTokens })
    },
  })

  const inputs = await processor(audio)
  const outputs = await model.generate({
    ...inputs,
    max_new_tokens: MAX_NEW_TOKENS,
    language,
    streamer,
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const decoded = tokenizer.batch_decode(outputs as any, { skip_special_tokens: true })
  self.postMessage({ status: "complete", output: decoded })
  processing = false
}

async function load() {
  self.postMessage({ status: "loading", data: "Loading model..." })
  await ASRPipeline.getInstance((x: unknown) => self.postMessage(x))
  self.postMessage({ status: "loading", data: "Compiling shaders and warming up model..." })
  const [, , model] = await ASRPipeline.getInstance()
  await model.generate({ input_features: full([1, 80, 3000], 0.0), max_new_tokens: 1 })
  self.postMessage({ status: "ready" })
}

self.addEventListener("message", async (e: MessageEvent) => {
  const { type, data } = e.data
  if (type === "load") load()
  if (type === "generate") generate(data)
})
