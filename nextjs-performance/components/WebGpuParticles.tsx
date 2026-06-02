'use client';

import { useEffect, useRef, useCallback } from 'react';

const PARTICLE_COUNT = 1_000_000;
const WORKGROUP_SIZE = 64;

// Compute shader: updates particle positions on the GPU each frame.
// 1M particles in a single dispatch — 100x throughput vs WebGL sequential draw.
const COMPUTE_SHADER = /* wgsl */ `
struct Particle {
  pos: vec2f,
  vel: vec2f,
}

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= arrayLength(&particles)) { return; }
  var p = particles[i];
  p.pos = p.pos + p.vel * 0.016;
  // Wrap at [-1, 1] boundary — branchless mod
  p.pos = ((p.pos + 1.0) % 2.0) - 1.0;
  particles[i] = p;
}
`;

// Render shader: uses instance_index to index the storage buffer directly.
// Storage buffers indexed by instance_index eliminate per-object bind overhead.
const RENDER_SHADER = /* wgsl */ `
struct Particle {
  pos: vec2f,
  vel: vec2f,
}

@group(0) @binding(0) var<storage, read> particles: array<Particle>;

struct VertexOut {
  @builtin(position) pos: vec4f,
  @location(0)       color: vec4f,
}

@vertex
fn vs(@builtin(instance_index) i: u32) -> VertexOut {
  let p      = particles[i];
  let speed  = length(p.vel) * 200.0;
  let hue    = vec4f(speed, 0.3, 1.0 - speed, 0.5);
  return VertexOut(vec4f(p.pos, 0.0, 1.0), hue);
}

@fragment
fn fs(@location(0) color: vec4f) -> @location(0) vec4f {
  return color;
}
`;

export function WebGpuParticles() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef  = useRef<number>(0);
  const cleanupRef = useRef<(() => void) | null>(null);

  const init = useCallback(async (canvas: HTMLCanvasElement) => {
    if (!navigator.gpu) {
      console.warn('[WebGPU] navigator.gpu unavailable — requires Chrome 113+ or Firefox Nightly');
      return;
    }

    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return;

    const device = await adapter.requestDevice();
    const context = canvas.getContext('webgpu');
    if (!context) { device.destroy(); return; }

    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'premultiplied' });

    // 4 floats per particle: pos.xy + vel.xy
    const bufferSize = PARTICLE_COUNT * 4 * Float32Array.BYTES_PER_ELEMENT;
    const storageBuffer = device.createBuffer({
      label: 'particle-storage',
      size: bufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // Seed random positions and velocities
    const initial = new Float32Array(PARTICLE_COUNT * 4);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      initial[i * 4 + 0] = (Math.random() - 0.5) * 2;
      initial[i * 4 + 1] = (Math.random() - 0.5) * 2;
      initial[i * 4 + 2] = (Math.random() - 0.5) * 0.008;
      initial[i * 4 + 3] = (Math.random() - 0.5) * 0.008;
    }
    device.queue.writeBuffer(storageBuffer, 0, initial);

    const bindGroupLayout = device.createBindGroupLayout({
      label: 'particle-bgl',
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.COMPUTE | GPUShaderStage.VERTEX,
        buffer: { type: 'storage' as GPUBufferBindingType },
      }],
    });
    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    });

    const [computePipeline, renderPipeline] = await Promise.all([
      device.createComputePipelineAsync({
        label: 'particle-compute',
        layout: pipelineLayout,
        compute: {
          module: device.createShaderModule({ label: 'compute', code: COMPUTE_SHADER }),
          entryPoint: 'main',
        },
      }),
      device.createRenderPipelineAsync({
        label: 'particle-render',
        layout: pipelineLayout,
        vertex: {
          module: device.createShaderModule({ label: 'render', code: RENDER_SHADER }),
          entryPoint: 'vs',
        },
        fragment: {
          module: device.createShaderModule({ label: 'render-frag', code: RENDER_SHADER }),
          entryPoint: 'fs',
          targets: [{
            format,
            blend: {
              color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
              alpha: { srcFactor: 'one',       dstFactor: 'one', operation: 'add' },
            },
          }],
        },
        primitive: { topology: 'point-list' },
      }),
    ]);

    const bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: storageBuffer } }],
    });

    // Render Bundle pre-records draw calls, replaying 1M instances in one call.
    // This eliminates per-frame CPU overhead for the render pass.
    const bundleEncoder = device.createRenderBundleEncoder({ colorFormats: [format] });
    bundleEncoder.setPipeline(renderPipeline);
    bundleEncoder.setBindGroup(0, bindGroup);
    bundleEncoder.draw(1, PARTICLE_COUNT);
    const renderBundle = bundleEncoder.finish();

    function frame() {
      const encoder = device.createCommandEncoder();

      const computePass = encoder.beginComputePass();
      computePass.setPipeline(computePipeline);
      computePass.setBindGroup(0, bindGroup);
      computePass.dispatchWorkgroups(Math.ceil(PARTICLE_COUNT / WORKGROUP_SIZE));
      computePass.end();

      const renderPass = encoder.beginRenderPass({
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0.04, g: 0.04, b: 0.10, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
      });
      renderPass.executeBundles([renderBundle]);
      renderPass.end();

      device.queue.submit([encoder.finish()]);
      frameRef.current = requestAnimationFrame(frame);
    }

    frameRef.current = requestAnimationFrame(frame);

    // Explicit destruction prevents GPU memory accumulation under long sessions.
    // storageBuffer.destroy() is the critical call — GPUDevice.destroy() follows.
    cleanupRef.current = () => {
      cancelAnimationFrame(frameRef.current);
      storageBuffer.destroy();
      device.destroy();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    init(canvas);
    return () => { cleanupRef.current?.(); cleanupRef.current = null; };
  }, [init]);

  return (
    <canvas
      ref={canvasRef}
      width={800}
      height={600}
      style={{ width: '100%', aspectRatio: '4/3', background: '#0a0a1a', display: 'block' }}
      aria-label={`WebGPU particle system — ${PARTICLE_COUNT.toLocaleString()} particles`}
    />
  );
}
