# Running the Email Model with Ollama

This directory contains scripts to run your fine-tuned email model (`model-fp16.gguf`) using Ollama.

## Prerequisites

1. Install Ollama from [https://ollama.ai](https://ollama.ai)
2. Ensure Ollama is running (it usually starts automatically)

## Quick Start

### Windows
```bash
run_ollama.bat
```

### Linux/Mac
```bash
chmod +x run_ollama.sh
./run_ollama.sh
```

## Manual Setup

If you prefer to set up manually:

1. **Create the model:**
   ```bash
   ollama create email-model -f Modelfile
   ```

2. **Run the model:**
   ```bash
   ollama run email-model
   ```

3. **Use in your code:**
   ```python
   import ollama

   response = ollama.chat(model='email-model', messages=[
       {
           'role': 'user',
           'content': 'Write a professional email requesting a meeting.'
       }
   ])
   print(response['message']['content'])
   ```

## Customization

You can modify the `Modelfile` to adjust:
- `temperature`: Controls randomness (0.0-1.0)
- `num_ctx`: Context window size
- `top_p`, `top_k`: Sampling parameters
- `SYSTEM`: System prompt for the model
- `TEMPLATE`: Chat template format

## API Usage

Once created, you can use the model via Ollama's REST API:

```bash
curl http://localhost:11434/api/generate -d '{
  "model": "email-model",
  "prompt": "Write a follow-up email"
}'
```

## Troubleshooting

- **Model not found**: Run the creation script again
- **Ollama not running**: Start Ollama service
- **Out of memory**: Reduce `num_ctx` in the Modelfile

## Useful Commands

- List models: `ollama list`
- Delete model: `ollama rm email-model`
- Show model info: `ollama show email-model`
