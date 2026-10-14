import {
  AutoTokenizer,
  AutoProcessor,
  WhisperForConditionalGeneration,
  TextStreamer,
  full,
} from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/dist/transformers.min.js"

const MODEL_ID = "onnx-community/whisper-base"
const MAX_NEW_TOKENS = 64

class ASRPipeline {
  static tokenizer = null
  static processor = null
  static model = null

  static async getInstance(progress_callback = null) {
    this.tokenizer ??= AutoTokenizer.from_pretrained(MODEL_ID, { progress_callback })
    this.processor ??= AutoProcessor.from_pretrained(MODEL_ID, { progress_callback })
    this.model ??= WhisperForConditionalGeneration.from_pretrained(MODEL_ID, {
      dtype: { encoder_model: "fp32", decoder_model_merged: "q4" },
      device: "webgpu",
      progress_callback,
    })
    return Promise.all([this.tokenizer, this.processor, this.model])
  }
}

let processing = false

async function generate({ audio, language }) {
  if (processing) return
  processing = true
  self.postMessage({ status: "start" })

  const [tokenizer, processor, model] = await ASRPipeline.getInstance()

  let numTokens = 0
  let startTime

  const streamer = new TextStreamer(tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    token_callback_function: () => {
      startTime ??= performance.now()
      numTokens++
    },
    callback_function: (output) => {
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

  const decoded = tokenizer.batch_decode(outputs, { skip_special_tokens: true })
  self.postMessage({ status: "complete", output: decoded })
  processing = false
}

async function load() {
  self.postMessage({ status: "loading", data: "Loading model..." })
  await ASRPipeline.getInstance((x) => self.postMessage(x))
  self.postMessage({ status: "loading", data: "Compiling shaders..." })
  const [, , model] = await ASRPipeline.getInstance()
  await model.generate({ input_features: full([1, 80, 3000], 0.0), max_new_tokens: 1 })
  self.postMessage({ status: "ready" })
}

self.addEventListener("message", async (e) => {
  const { type, data } = e.data
  if (type === "load") load()
  if (type === "generate") generate(data)
})
