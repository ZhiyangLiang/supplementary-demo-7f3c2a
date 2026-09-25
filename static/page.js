(() => {
  let activePair = null;

  function waitForMetadata(video) {
    if (video.readyState >= 1) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => finish(new Error("Video loading timed out")), 60000);
      const loaded = () => finish();
      const failed = () => finish(new Error("Video failed to load"));

      function finish(error) {
        window.clearTimeout(timeout);
        video.removeEventListener("loadedmetadata", loaded);
        video.removeEventListener("error", failed);
        if (error) reject(error);
        else resolve();
      }

      video.addEventListener("loadedmetadata", loaded);
      video.addEventListener("error", failed);
    });
  }

  function attachSource(video) {
    if (video.src) return;
    video.src = video.dataset.src;
    video.preload = "metadata";
    video.load();
  }

  const demo = document.querySelector("[data-demo-player]");
  if (demo) {
    const video = demo.querySelector("video");
    const button = demo.querySelector(".load-video");
    const status = demo.querySelector(".status");

    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "Loading...";
      status.textContent = "";
      try {
        attachSource(video);
        await waitForMetadata(video);
        demo.dataset.loaded = "true";
        await video.play();
      } catch (error) {
        button.disabled = false;
        button.textContent = "Retry overview";
        status.textContent = error.message;
      }
    });
  }

  for (const card of document.querySelectorAll("[data-pair]")) {
    const videos = [...card.querySelectorAll("video")];
    const [proxy, output] = videos;
    const play = card.querySelector(".pair-play");
    const seek = card.querySelector(".pair-seek");
    const sound = card.querySelector(".pair-sound");
    const status = card.querySelector(".status");
    let ready = false;
    let loading = null;
    let playing = false;
    let frameRequest = 0;

    function duration() {
      const values = videos
        .map((video) => video.duration)
        .filter((value) => Number.isFinite(value) && value > 0);
      return values.length ? Math.min(...values) : 0;
    }

    async function load() {
      if (ready) return;
      if (loading) return loading;
      play.disabled = true;
      play.textContent = "Loading...";
      status.textContent = "";
      videos.forEach(attachSource);
      loading = Promise.all(videos.map(waitForMetadata))
        .then(() => {
          if (!duration()) throw new Error("Video duration is unavailable");
          ready = true;
          seek.disabled = false;
        })
        .finally(() => {
          play.disabled = false;
          if (!playing) play.textContent = "Play";
        });
      return loading;
    }

    function updateProgress() {
      const total = duration();
      seek.value = total ? String(Math.round((output.currentTime / total) * 1000)) : "0";
      if (playing) frameRequest = window.requestAnimationFrame(updateProgress);
    }

    function synchronize(force = false) {
      if (!ready) return;
      const drift = proxy.currentTime - output.currentTime;
      if (force || Math.abs(drift) > 0.1) proxy.currentTime = output.currentTime;
    }

    function pause() {
      playing = false;
      videos.forEach((video) => video.pause());
      window.cancelAnimationFrame(frameRequest);
      play.textContent = "Play";
      if (activePair === pause) activePair = null;
    }

    async function start() {
      if (activePair && activePair !== pause) activePair();
      activePair = pause;
      await load();
      const total = duration();
      if (output.currentTime >= total - 0.05) {
        videos.forEach((video) => {
          video.currentTime = 0;
        });
      }
      synchronize(true);
      playing = true;
      await Promise.all(videos.map((video) => video.play()));
      play.textContent = "Pause";
      window.cancelAnimationFrame(frameRequest);
      updateProgress();
    }

    play.addEventListener("click", () => {
      status.textContent = "";
      if (playing) {
        pause();
        return;
      }
      start().catch((error) => {
        pause();
        status.textContent = error.message;
        play.textContent = "Retry";
      });
    });

    seek.addEventListener("input", () => {
      if (!ready) return;
      const target = duration() * (Number(seek.value) / 1000);
      videos.forEach((video) => {
        video.currentTime = target;
      });
    });

    output.addEventListener("timeupdate", () => synchronize(false));
    output.addEventListener("ended", pause);

    sound.addEventListener("click", () => {
      output.muted = !output.muted;
      proxy.muted = true;
      sound.textContent = output.muted ? "Sound off" : "Sound on";
      sound.setAttribute("aria-pressed", String(!output.muted));
    });

    videos.forEach((video) => {
      video.addEventListener("error", () => {
        if (!ready) return;
        pause();
        status.textContent = "Video playback failed";
      });
    });

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting && playing) pause();
    }, { rootMargin: "120px" });
    observer.observe(card);
  }

  window.addEventListener("pagehide", () => {
    if (activePair) activePair();
  });
})();
