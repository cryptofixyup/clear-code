// Global WebGPU type augmentation. Pulls @webgpu/types into the project so the
// WebGPU components (navigator.gpu, GPUBufferUsage, GPUShaderStage, GPUCanvasContext)
// typecheck under `next build`. Browser-runtime modules are excluded from the
// narrow CI typecheck (tsconfig.ci.json) but this keeps editor + build honest.
/// <reference types="@webgpu/types" />
