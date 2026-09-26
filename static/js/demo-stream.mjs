import {readResource} from './resource-fetch.mjs';

const manifestURL = 'static/demo/seekable/manifest.json';
const MediaSourceClass = window.MediaSource || window.ManagedMediaSource;

export function supportsSeekableDemo() {
  return Boolean(MediaSourceClass?.isTypeSupported);
}

export function createSeekableDemo(video, onError) {
  const media = new MediaSourceClass();
  const objectURL = URL.createObjectURL(media);
  const lifetime = new AbortController();
  let tracks = [], duration = 0, started = false, disposed = false, failed = false;
  const read = (url, type) => readResource(url, {
    signal:lifetime.signal, type, label:'Demo segment', timeoutMs:45000,
  });

  function fail(error) {
    if (disposed || failed || lifetime.signal.aborted) return;
    failed = true;
    onError(error);
  }
  function append(track, data) {
    lifetime.signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const buffer = track.buffer;
      const finish = error => {
        buffer.removeEventListener('updateend', updated);
        buffer.removeEventListener('error', errorEvent);
        buffer.removeEventListener('abort', aborted);
        lifetime.signal.removeEventListener('abort', aborted);
        if (error) reject(error); else resolve();
      };
      const updated = () => finish();
      const errorEvent = () => finish(new Error('The browser could not decode a demo segment.'));
      const aborted = () => finish(lifetime.signal.reason || new DOMException('Segment append aborted', 'AbortError'));
      buffer.addEventListener('updateend', updated, {once:true});
      buffer.addEventListener('error', errorEvent, {once:true});
      buffer.addEventListener('abort', aborted, {once:true});
      lifetime.signal.addEventListener('abort', aborted, {once:true});
      try { buffer.appendBuffer(data); } catch (error) { finish(error); }
    });
  }
  function requestedSegments(track) {
    const time = Math.max(0, Math.min(video.currentTime, duration - .001));
    const found = track.segments.findIndex(segment => segment.end > time);
    const index = found < 0 ? track.segments.length - 1 : found;
    return [index, Math.min(index + 1, track.segments.length - 1)];
  }
  function finishStream() {
    if (disposed || failed || media.readyState !== 'open' || !tracks.length) return;
    if (tracks.every(track => !track.busy && !track.buffer.updating
        && track.loaded.has(track.segments.length - 1))) {
      media.endOfStream();
    }
  }
  async function pump(track) {
    if (track.busy || disposed || failed) return;
    track.busy = true;
    try {
      if (!track.initialized) {
        await append(track, await read(track.init, 'arrayBuffer'));
        track.initialized = true;
      }
      while (!disposed && !failed) {
        const index = requestedSegments(track).find(index => !track.loaded.has(index));
        if (index === undefined) break;
        const data = await read(track.segments[index].url, 'arrayBuffer');
        lifetime.signal.throwIfAborted();
        // A scrub may have moved elsewhere while this package was downloading.
        if (!requestedSegments(track).includes(index)) continue;
        await append(track, data);
        track.loaded.add(index);
      }
    } finally {
      track.busy = false;
      finishStream();
    }
  }
  function schedule() {
    if (!disposed && !failed) tracks.forEach(track => pump(track).catch(fail));
  }
  async function open() {
    if (started || disposed) return;
    started = true;
    const manifest = await read(manifestURL, 'json');
    if (!Number.isFinite(manifest.duration) || manifest.duration <= 0
        || !Array.isArray(manifest.tracks) || !manifest.tracks.length) {
      throw new Error('The demo segment manifest is invalid.');
    }
    duration = manifest.duration;
    for (const track of manifest.tracks) {
      if (!MediaSourceClass.isTypeSupported(track.mime)) {
        throw new Error('This browser does not support the seekable H.264/AAC demo.');
      }
      if (!Array.isArray(track.segments) || !track.segments.length
          || track.segments.some(segment => !Number.isFinite(segment.start)
            || !Number.isFinite(segment.end) || segment.end <= segment.start)) {
        throw new Error('The demo segment timeline is invalid.');
      }
    }
    tracks = manifest.tracks.map(track => ({
      ...track, buffer:media.addSourceBuffer(track.mime),
      loaded:new Set(), busy:false, initialized:false,
    }));
    media.duration = duration;
    schedule();
  }
  const onOpen = () => { open().catch(fail); };
  const onClose = () => { if (!disposed) fail(new Error('The demo media connection closed unexpectedly.')); };
  media.addEventListener('sourceopen', onOpen);
  media.addEventListener('sourceclose', onClose);
  for (const name of ['seeking','timeupdate','waiting','play']) video.addEventListener(name, schedule);
  video.disableRemotePlayback = true;
  video.src = objectURL;
  video.dataset.delivery = 'seekable-segments';
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      lifetime.abort();
      media.removeEventListener('sourceopen', onOpen);
      media.removeEventListener('sourceclose', onClose);
      for (const name of ['seeking','timeupdate','waiting','play']) video.removeEventListener(name, schedule);
      for (const track of tracks) {
        if (media.readyState === 'open' && track.buffer.updating) track.buffer.abort();
      }
      URL.revokeObjectURL(objectURL);
    },
  };
}
