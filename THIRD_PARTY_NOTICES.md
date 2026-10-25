# Third-party notices

GEO_SC's own code has no third-party dependencies. The optional AI depth feature uses the following. Both licences allow commercial use.

## Depth Anything V2 Small

The depth model, downloaded by `npm run setup` into `models/`.

- Authors: Lihe Yang, Bingyi Kang, Zilong Huang, Zhen Zhao, Xiaogang Xu, Jiashi Feng, Hengshuang Zhao
- Source: https://github.com/DepthAnything/Depth-Anything-V2
- ONNX conversion: https://huggingface.co/onnx-community/depth-anything-v2-small
- Licence: Apache License 2.0 (the Small model only; the larger variants use a non-commercial licence and are not used here)

## ONNX Runtime Web

Runs the model in the browser, copied by `npm run setup` into `vendor/ort/` with its licence file.

- Copyright (c) Microsoft Corporation
- Source: https://github.com/microsoft/onnxruntime
- Licence: MIT
