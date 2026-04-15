# Image Generation

Generate images from Quick sites via the AI proxy. Since `/api/ai` is a passthrough to Shopify's LLM proxy, any supported image generation model works.

## Image API (Simple)

Direct image generation from a prompt. Best for single-shot generation.

```javascript
import OpenAI from "https://cdn.jsdelivr.net/npm/openai/+esm";

const openai = new OpenAI({
  baseURL: `${window.location.origin}/api/ai`,
  apiKey: "not-needed",
  dangerouslyAllowBrowser: true,
});

const response = await openai.images.generate({
  model: "gpt-image-1.5",  // or gpt-image-1, gpt-image-1-mini
  prompt: "A sunset over mountains in watercolor style",
  size: "1024x1024",
  quality: "auto",
  n: 1,
});

const imgSrc = `data:image/png;base64,${response.data[0].b64_json}`;
```

### Available Models

| Model | Notes |
|---|---|
| `gpt-image-1.5` | Latest, highest quality |
| `gpt-image-1` | High quality, reliable |
| `gpt-image-1-mini` | Faster, lower cost |

## Responses API (Conversational)

Use the Responses API for image editing, image-to-image transformations, and multi-turn workflows.

```javascript
// Text-to-image
const response = await openai.responses.create({
  model: "gpt-5.2",
  input: [{ role: "user", content: "A cute cat wearing a hat" }],
  tools: [{ type: "image_generation", size: "1024x1024", quality: "low" }],
});

const imageData = response.output
  .filter((o) => o.type === "image_generation_call")
  .map((o) => o.result);

const imgSrc = `data:image/png;base64,${imageData[0]}`;
```

### Image-to-Image (Editing/Transformations)

Pass an input image alongside a text prompt:

```javascript
const response = await openai.responses.create({
  model: "gpt-5.2",
  input: [
    {
      role: "user",
      content: [
        { type: "input_text", text: "Transform this into a professional headshot" },
        { type: "input_image", image_url: base64DataUrl },
      ],
    },
  ],
  tools: [{
    type: "image_generation",
    size: "1024x1024",
    quality: "low",
    output_format: "jpeg",
  }],
});
```

### Image Generation Tool Options

| Option | Values | Default |
|---|---|---|
| `size` | `1024x1024`, `1536x1024`, `1024x1536`, `auto` | `auto` |
| `quality` | `low`, `medium`, `high`, `auto` | `auto` |
| `output_format` | `png`, `jpeg`, `webp` | `png` |

## fal.ai (Flux)

Fast image generation via fal.ai through Quick's vendor proxy:

```javascript
const response = await fetch("/api/ai/vendors/fal-run/fal-ai/flux/schnell", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    prompt: "a mountain landscape at dawn",
    image_size: { width: 1024, height: 1024 },
    num_images: 1,
  }),
});

const data = await response.json();
const imgSrc = data.images[0].url;
```

Flux Schnell is fast (~2-5s) and good for rapid iteration.

## Tips

- **Compress input images** before sending — resize to 512x512 max to keep request sizes reasonable
- **Displaying results** — generated images come back as base64; set directly as `img.src`
- **Downloading** — create an anchor with `download` attribute:

```javascript
const a = document.createElement("a");
a.href = imgSrc;
a.download = "generated.png";
a.click();
```
