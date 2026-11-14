// Engine ticker. Page timers are throttled (and animation frames stop entirely) when
// the screen locks or the tab is hidden; a timer inside a Worker keeps running, so the
// panel keeps following the drive. Falls back to setInterval where Workers are blocked.
export function createTicker(fn, ms = 100) {
  let worker = null;
  let timer = null;
  try {
    const src = "let t=null;onmessage=(e)=>{clearInterval(t);if(e.data>0)t=setInterval(()=>postMessage(0),e.data)}";
    const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    worker = new Worker(url);
    worker.onmessage = () => fn();
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      if (timer === null) timer = setInterval(fn, ms);
    };
    worker.postMessage(ms);
  } catch {
    timer = setInterval(fn, ms);
  }
  return {
    get kind() { return worker ? "worker" : "interval"; },
    stop() {
      worker?.postMessage(0);
      worker?.terminate();
      worker = null;
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
  };
}
