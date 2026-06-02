'use client';

import { useEffect, useRef, useState } from 'react';

// GPU-rendered time-series chart for the live CRDT metrics.
//
// Why WebGPU for a 4-line chart? The same storage-buffer + instanced-draw
// technique that renders 1M particles renders N series of M points with a
// single draw call — each series is one instanced line-strip. Smooth value
// transitions are interpolated on the GPU (mix(prev, cur, lerp)) so the chart
// animates between polls without rebuilding geometry on the CPU.

type MetricName = 'page_views' | 'api_calls' | 'events_processed' | 'errors';

interface SeriesDef {
  readonly key: MetricName;
  readonly label: string;
  readonly rgba: readonly [number, number, number, number];
  readonly css: string;
}

const SERIES: readonly SeriesDef[] = [
  { key: 'page_views',       label: 'Page Views',       rgba: [0.23, 0.51, 0.96, 1], css: '#3b82f6' },
  { key: 'api_calls',        label: 'API Calls',        rgba: [0.06, 0.72, 0.51, 1], css: '#10b981' },
  { key: 'events_processed', label: 'Events Processed', rgba: [0.54, 0.36, 0.96, 1], css: '#8b5cf6' },
  { key: 'errors',           label: 'Errors',           rgba: [0.94, 0.27, 0.27, 1], css: '#ef4444' },
];

const POINT_COUNT = 60;       // matches MAX_HISTORY in metrics-store
const POLL_MS = 2000;
const ANIM_MS = 600;
const Y_SPAN = 0.85;          // vertical fraction of NDC the chart occupies

type HistoryResponse = Partial<Record<MetricName, Array<{ ts: number; val: number }>>>;
type RenderMode = 'connecting' | 'webgpu' | 'canvas2d' | 'unavailable';

// Normalize the server history into a flat [series][point] NDC-y buffer.
// Series shorter than POINT_COUNT are left-padded with their earliest value
// so the buffer is always full-size and the shader needs no bounds logic.
function buildBuffer(history: HistoryResponse): { ndcY: Float32Array<ArrayBuffer>; max: number } {
  let max = 1;
  for (const s of SERIES) {
    for (const point of history[s.key] ?? []) {
      if (point.val > max) max = point.val;
    }
  }

  const ndcY = new Float32Array(SERIES.length * POINT_COUNT);
  SERIES.forEach((s, si) => {
    const raw = history[s.key] ?? [];
    const padCount = POINT_COUNT - raw.length;
    const firstVal = raw[0]?.val ?? 0;
    for (let i = 0; i < POINT_COUNT; i++) {
      const val = i < padCount ? firstVal : (raw[i - padCount]?.val ?? 0);
      // Baseline at bottom (-Y_SPAN), grows upward to +Y_SPAN.
      ndcY[si * POINT_COUNT + i] = -Y_SPAN + (val / max) * (2 * Y_SPAN);
    }
  });
  return { ndcY, max };
}

const CHART_SHADER = /* wgsl */ `
struct Uniforms {
  lerp: f32,
  pointCount: f32,
  _pad0: f32,
  _pad1: f32,
};
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> cur: array<f32>;
@group(0) @binding(2) var<storage, read> prev: array<f32>;
@group(0) @binding(3) var<uniform> colors: array<vec4f, 4>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0)       color: vec4f,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) si: u32) -> VOut {
  let pc = u32(u.pointCount);
  let idx = si * pc + vi;
  let y = mix(prev[idx], cur[idx], u.lerp);
  let x = (f32(vi) / (u.pointCount - 1.0)) * 1.8 - 0.9;
  var out: VOut;
  out.pos = vec4f(x, y, 0.0, 1.0);
  out.color = colors[si];
  return out;
}

@fragment
fn fs(@location(0) color: vec4f) -> @location(0) vec4f {
  return color;
}
`;

export function WebGpuMetricsChart() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<RenderMode>('connecting');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    let stop = (): void => {};
    let disposed = false;

    // Shared polling loop — feeds whichever renderer is active.
    function startPolling(onData: (buf: Float32Array<ArrayBuffer>, max: number) => void): () => void {
      let active = true;
      async function tick(): Promise<void> {
        try {
          const res = await fetch('/api/metrics/history');
          const json = (await res.json()) as HistoryResponse;
          if (active) {
            const { ndcY, max } = buildBuffer(json);
            onData(ndcY, max);
          }
        } catch { /* transient fetch error — retry on next tick */ }
      }
      void tick();
      const id = setInterval(() => { void tick(); }, POLL_MS);
      return () => { active = false; clearInterval(id); };
    }

    async function initWebGpu(gpu: GPU): Promise<boolean> {
      const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (adapter === null) return false;
      const device = await adapter.requestDevice();
      const context = canvas!.getContext('webgpu');
      if (context === null) { device.destroy(); return false; }

      const format = gpu.getPreferredCanvasFormat();
      context.configure({ device, format, alphaMode: 'premultiplied' });

      const bufSize = SERIES.length * POINT_COUNT * Float32Array.BYTES_PER_ELEMENT;
      const curBuf = device.createBuffer({ label: 'chart-cur', size: bufSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      const prevBuf = device.createBuffer({ label: 'chart-prev', size: bufSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      const uniformBuf = device.createBuffer({ label: 'chart-uniform', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const colorBuf = device.createBuffer({ label: 'chart-colors', size: 4 * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

      const colorData = new Float32Array(4 * 4);
      SERIES.forEach((s, i) => { colorData.set(s.rgba, i * 4); });
      device.queue.writeBuffer(colorBuf, 0, colorData);

      const bgl = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
          { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
          { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
          { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        ],
      });

      const pipeline = await device.createRenderPipelineAsync({
        layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
        vertex: { module: device.createShaderModule({ code: CHART_SHADER }), entryPoint: 'vs' },
        fragment: {
          module: device.createShaderModule({ code: CHART_SHADER }),
          entryPoint: 'fs',
          targets: [{ format }],
        },
        primitive: { topology: 'line-strip' },
      });

      const bindGroup = device.createBindGroup({
        layout: bgl,
        entries: [
          { binding: 0, resource: { buffer: uniformBuf } },
          { binding: 1, resource: { buffer: curBuf } },
          { binding: 2, resource: { buffer: prevBuf } },
          { binding: 3, resource: { buffer: colorBuf } },
        ],
      });

      let curArr = new Float32Array(SERIES.length * POINT_COUNT);
      let animStart = 0;
      let raf = 0;

      device.queue.writeBuffer(curBuf, 0, curArr);
      device.queue.writeBuffer(prevBuf, 0, curArr);

      const stopPolling = startPolling((next) => {
        device.queue.writeBuffer(prevBuf, 0, curArr);
        device.queue.writeBuffer(curBuf, 0, next);
        curArr = next;
        animStart = performance.now();
      });

      function frame(): void {
        const lerp = Math.min(1, (performance.now() - animStart) / ANIM_MS);
        device.queue.writeBuffer(uniformBuf, 0, new Float32Array([lerp, POINT_COUNT, 0, 0]));

        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
          colorAttachments: [{
            view: context!.getCurrentTexture().createView(),
            clearValue: { r: 0.04, g: 0.04, b: 0.10, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          }],
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.draw(POINT_COUNT, SERIES.length);
        pass.end();
        device.queue.submit([encoder.finish()]);
        raf = requestAnimationFrame(frame);
      }
      raf = requestAnimationFrame(frame);

      stop = () => {
        cancelAnimationFrame(raf);
        stopPolling();
        curBuf.destroy();
        prevBuf.destroy();
        uniformBuf.destroy();
        colorBuf.destroy();
        device.destroy();
      };
      return true;
    }

    // Canvas2D fallback — same data, no GPU. Keeps the chart useful everywhere.
    function initCanvas2d(): void {
      const ctx = canvas!.getContext('2d');
      if (ctx === null) { setMode('unavailable'); return; }

      let curArr = new Float32Array(SERIES.length * POINT_COUNT);
      let prevArr = curArr;
      let animStart = 0;
      let raf = 0;

      const stopPolling = startPolling((next) => {
        prevArr = curArr;
        curArr = next;
        animStart = performance.now();
      });

      function draw(): void {
        const lerp = Math.min(1, (performance.now() - animStart) / ANIM_MS);
        const w = canvas!.width;
        const h = canvas!.height;
        ctx!.fillStyle = '#0a0a1a';
        ctx!.fillRect(0, 0, w, h);

        SERIES.forEach((s, si) => {
          ctx!.strokeStyle = s.css;
          ctx!.lineWidth = 2;
          ctx!.beginPath();
          for (let i = 0; i < POINT_COUNT; i++) {
            const idx = si * POINT_COUNT + i;
            const ndc = prevArr[idx]! + (curArr[idx]! - prevArr[idx]!) * lerp;
            const x = (i / (POINT_COUNT - 1)) * w;
            const y = h - ((ndc + Y_SPAN) / (2 * Y_SPAN)) * h;
            if (i === 0) ctx!.moveTo(x, y); else ctx!.lineTo(x, y);
          }
          ctx!.stroke();
        });
        raf = requestAnimationFrame(draw);
      }
      raf = requestAnimationFrame(draw);

      stop = () => { cancelAnimationFrame(raf); stopPolling(); };
    }

    void (async () => {
      const gpu = navigator.gpu;
      if (gpu !== undefined) {
        try {
          if (await initWebGpu(gpu)) { if (!disposed) setMode('webgpu'); return; }
        } catch { /* fall through to 2D */ }
      }
      if (disposed) return;
      initCanvas2d();
      setMode((m) => (m === 'unavailable' ? m : 'canvas2d'));
    })();

    return () => { disposed = true; stop(); };
  }, []);

  return (
    <div>
      <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', marginBottom: '0.75rem', alignItems: 'center' }}>
        {SERIES.map((s) => (
          <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: '#64748b' }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: s.css, display: 'inline-block' }} />
            {s.label}
          </span>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: '#94a3b8' }}>
          {mode === 'webgpu' && '● GPU-rendered'}
          {mode === 'canvas2d' && '● Canvas2D fallback'}
          {mode === 'connecting' && '○ Initializing...'}
          {mode === 'unavailable' && '⚠ Rendering unavailable'}
        </span>
      </div>
      <canvas
        ref={canvasRef}
        width={800}
        height={300}
        style={{ width: '100%', aspectRatio: '8/3', background: '#0a0a1a', display: 'block', borderRadius: 8 }}
        aria-label="WebGPU time-series chart of live metrics"
      />
    </div>
  );
}
