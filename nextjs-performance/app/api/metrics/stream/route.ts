import { getMetrics } from '@/lib/server/metrics-store';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const encoder = new TextEncoder();
  let intervalId: ReturnType<typeof setInterval>;

  const stream = new ReadableStream({
    start(controller) {
      function send() {
        try {
          const data = JSON.stringify(getMetrics());
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          clearInterval(intervalId);
          controller.close();
        }
      }
      send();
      intervalId = setInterval(send, 2000);
    },
    cancel() {
      clearInterval(intervalId);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
