@echo off
REM Ollama Email Model Runner (Windows)
REM This script creates and runs the email finetuned model in Ollama

set MODEL_NAME=email-model

echo Creating Ollama model from GGUF file...
echo.

REM Create the model from the Modelfile
ollama create %MODEL_NAME% -f Modelfile

if %errorlevel% equ 0 (
    echo Model '%MODEL_NAME%' created successfully!
    echo.
    echo You can now use the model with:
    echo   ollama run %MODEL_NAME%
    echo.
    set /p REPLY="Start interactive chat now? (y/n): "
    if /i "%REPLY%"=="y" (
        ollama run %MODEL_NAME%
    )
) else (
    echo Failed to create model. Please check if Ollama is installed and running.
    exit /b 1
)
