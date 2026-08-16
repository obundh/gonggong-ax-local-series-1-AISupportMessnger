# Local Image Model Packs

Place local image generation model files here for 김그림.

Recommended layout:

- `models/image/sdxl/` for SDXL checkpoints, LoRA files, VAEs, and metadata.
- `models/image/flux/` for FLUX model packs.
- `models/image/workflows/` for ComfyUI workflow JSON files.

The app also checks a running ComfyUI server at `http://127.0.0.1:8188` by default. Set `HEYU_COMFYUI_URL` if ComfyUI is hosted at another local address. When ComfyUI has at least one checkpoint, 김그림 can send a basic text-to-image workflow and save the generated image under the workspace image output folder.

When a model exists in this folder, the app writes `models/image/comfy_extra_model_paths.yaml`. Start ComfyUI with that file if you want ComfyUI to load checkpoints directly from this app folder:

```powershell
python main.py --extra-model-paths-config "<PROJECT_ROOT>\models\image\comfy_extra_model_paths.yaml"
```

`dreamshaperXL_lightningDPMSDE.safetensors` is recognized as DreamShaper XL Lightning and uses a low-step DPM++ SDE profile automatically.

This folder is not included in the current installer file list. If you place model weights here, keep them as a separate local or isolated-network model pack unless the checkpoint license explicitly allows redistribution.
