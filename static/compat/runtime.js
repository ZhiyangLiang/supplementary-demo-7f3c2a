(() => {
  'use strict';
  const nativeWindow = window;
  const nativeDocument = document;
  const base = new URL('../../', nativeDocument.currentScript.src);
  const assets = new Map();
  const programs = new Map();
  const requests = new Map();
  const nativeRAF = nativeWindow.requestAnimationFrame.bind(nativeWindow);
  const nativeCancelRAF = nativeWindow.cancelAnimationFrame.bind(nativeWindow);
  let registry;

  function keyFor(value, from = base.href) {
    const url = new URL(String(value), from);
    if (!url.href.startsWith(base.href)) throw new Error(`Non-local resource: ${url.pathname}`);
    return decodeURIComponent(url.pathname.slice(base.pathname.length));
  }
  function loadScript(path) {
    if (requests.has(path)) return requests.get(path);
    const promise = new Promise((resolve, reject) => {
      const script = nativeDocument.createElement('script');
      script.src = new URL(path, base).href;
      script.onload = () => { script.remove(); resolve(); };
      script.onerror = () => { script.remove(); requests.delete(path); reject(new TypeError(`Unable to load ${path}`)); };
      nativeDocument.head.append(script);
    });
    requests.set(path, promise);
    return promise;
  }
  async function asset(key) {
    if (!assets.has(key)) {
      const path = registry.assets[key];
      if (!path) throw new Error(`Resource is not packaged: ${key}`);
      await loadScript(path);
    }
    const result = assets.get(key);
    if (!result) throw new Error(`Resource package did not register: ${key}`);
    return result;
  }
  function bytes(record) {
    const decoded = atob(record.data);
    const result = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index++) result[index] = decoded.charCodeAt(index);
    return result;
  }
  function dataURL(key) {
    const record = assets.get(key);
    if (!record) throw new Error(`Scene asset was not prepared: ${key}`);
    return `data:${record.type};base64,${record.data}`;
  }
  async function localFetch(value, options, from) {
    options?.signal?.throwIfAborted();
    const url = typeof value === 'string' || value instanceof URL ? String(value) : value.url;
    const pending = asset(keyFor(url, from));
    const record = options?.signal ? await new Promise((resolve, reject) => {
      const cancel = () => { cleanup(); reject(options.signal.reason); };
      const cleanup = () => options.signal.removeEventListener('abort', cancel);
      options.signal.addEventListener('abort', cancel, {once:true});
      pending.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
      if (options.signal.aborted) cancel();
    }) : await pending;
    options?.signal?.throwIfAborted();
    return new Response(bytes(record), {status: 200, headers: {'Content-Type': record.type}});
  }

  // These views share only application-owned state in this document. They do
  // not create or access browser frames, change CSP, or acquire a non-opaque origin.
  function scopeFor(host, url, parentScope, root = false) {
    const events = root ? nativeWindow : new EventTarget();
    const documentEvents = new EventTarget();
    const state = root ? nativeWindow : {};
    const rafs = new Set(), timers = new Set(), intervals = new Set(), children = new Set();
    const shadow = root ? null : host.attachShadow({mode: 'open'});
    let html = root ? nativeDocument.documentElement : null;
    let body = root ? nativeDocument.body : null;
    let head = root ? nativeDocument.head : null;
    let baseURL = new URL(url, base);
    let readyState = 'loading', closed = false;
    let scopeWindow, scopeDocument;

    const history = root ? {
      get state() { return nativeWindow.history.state; },
      replaceState(value, unused, destination) { navigate(value, destination, false); },
      pushState(value, unused, destination) { navigate(value, destination, true); },
      back: () => nativeWindow.history.back(),
      forward: () => nativeWindow.history.forward(),
    } : {replaceState() {}, pushState() {}};
    let locationURL = new URL(url, base);
    function navigate(value, destination, push) {
      const next = new URL(destination || locationURL.href, locationURL);
      if (next.origin !== base.origin || !next.pathname.startsWith(base.pathname)) {
        throw new Error('Navigation must stay inside this project page');
      }
      locationURL = next;
      const method = push ? 'pushState' : 'replaceState';
      if (nativeWindow.origin === 'null') {
        const actual = new URL(nativeWindow.location.href);
        actual.hash = 'view=' + encodeURIComponent(next.search + next.hash);
        nativeWindow.history[method](value, '', actual.href);
      } else nativeWindow.history[method](value, '', next.href);
    }
    const location = new Proxy({}, {
      get(_, name) {
        if (name === 'reload') return () => nativeWindow.location.reload();
        if (name === 'replace' || name === 'assign') return destination => {
          nativeWindow.location[name](new URL(destination, locationURL).href);
        };
        if (name === 'toString') return () => locationURL.href;
        return locationURL[name];
      },
      set(_, name, value) { locationURL[name] = value; return true; },
    });
    if (root) {
      const restoreURL = () => {
        const actual = new URL(nativeWindow.location.href);
        const restoredView = actual.hash.startsWith('#view=');
        locationURL = restoredView
          ? new URL(decodeURIComponent(actual.hash.slice(6)) || '.', base)
          : actual;
        const landing = locationURL.pathname === base.pathname
          || locationURL.pathname === new URL('index.html', base).pathname;
        if (landing && !restoredView && !locationURL.hash
            && !locationURL.searchParams.has('case') && !locationURL.searchParams.has('category')) {
          locationURL.searchParams.set('category', 'gallery');
        }
      };
      restoreURL();
      nativeWindow.addEventListener('popstate', restoreURL);
      nativeWindow.addEventListener('hashchange', restoreURL);
    }
    function emit(target, type, properties = {}) {
      const event = new Event(type);
      for (const [key, value] of Object.entries(properties)) Object.defineProperty(event, key, {value});
      target.dispatchEvent(event);
    }
    function patchImage(image) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
      Object.defineProperty(image, 'src', {
        get() { return descriptor.get.call(image); },
        set(value) {
          const resolved = /^(data:|blob:)/.test(value) ? value : dataURL(keyFor(value, baseURL.href));
          descriptor.set.call(image, resolved);
        },
      });
      return image;
    }
    function createElement(tag, options) {
      if (tag.toLowerCase() === 'iframe') {
        const view = createView(scope);
        children.add(view);
        return view;
      }
      const element = nativeDocument.createElement(tag, options);
      return !root && tag.toLowerCase() === 'img' ? patchImage(element) : element;
    }
    const documentOverrides = {
      get documentElement() { return html; },
      get body() { return body; },
      get head() { return head; },
      get baseURI() { return baseURL.href; },
      get URL() { return location.href; },
      get readyState() { return readyState; },
      get defaultView() { return scopeWindow; },
      get activeElement() { return root ? nativeDocument.activeElement : shadow.activeElement; },
      get hidden() { return nativeDocument.hidden; },
      createElement,
      createElementNS(namespace, tag, options) {
        const element = nativeDocument.createElementNS(namespace, tag, options);
        return !root && tag.toLowerCase() === 'img' ? patchImage(element) : element;
      },
      getElementById: id => root ? nativeDocument.getElementById(id) : shadow.getElementById(id),
      querySelector: selector => (root ? nativeDocument : shadow).querySelector(selector.replaceAll('iframe', 'cvm-view')),
      querySelectorAll: selector => (root ? nativeDocument : shadow).querySelectorAll(selector.replaceAll('iframe', 'cvm-view')),
      addEventListener(type, listener, options) {
        (type === 'DOMContentLoaded' ? documentEvents : root ? nativeDocument : shadow).addEventListener(type, listener, options);
      },
      removeEventListener(type, listener, options) {
        (type === 'DOMContentLoaded' ? documentEvents : root ? nativeDocument : shadow).removeEventListener(type, listener, options);
      },
    };
    scopeDocument = new Proxy({}, {get(_, name) {
      if (name in documentOverrides) return documentOverrides[name];
      const value = nativeDocument[name];
      return typeof value === 'function' ? value.bind(nativeDocument) : value;
    }});
    const methods = {
      requestAnimationFrame(callback) {
        if (closed) return 0;
        const id = nativeRAF(time => { rafs.delete(id); if (!closed) callback(time); });
        rafs.add(id); return id;
      },
      cancelAnimationFrame(id) { rafs.delete(id); nativeCancelRAF(id); },
      setTimeout(callback, delay, ...args) {
        const id = nativeWindow.setTimeout(() => { timers.delete(id); if (!closed) callback(...args); }, delay);
        timers.add(id); return id;
      },
      clearTimeout(id) { timers.delete(id); nativeWindow.clearTimeout(id); },
      setInterval(callback, delay, ...args) {
        const id = nativeWindow.setInterval(() => { if (!closed) callback(...args); }, delay);
        intervals.add(id); return id;
      },
      clearInterval(id) { intervals.delete(id); nativeWindow.clearInterval(id); },
    };
    const parent = parentScope ? new Proxy({}, {get(_, name) {
      if (name === 'postMessage') return data => queueMicrotask(() => {
        if (!closed) emit(parentScope.events, 'message', {data, source: scopeWindow, origin: location.origin});
      });
      return parentScope.window[name];
    }}) : null;
    scopeWindow = new Proxy({}, {
      get(_, name) {
        if (name === 'window' || name === 'self' || name === 'globalThis') return scopeWindow;
        if (name === 'parent') return parent || scopeWindow;
        if (name === 'document') return scopeDocument;
        if (name === 'location') return location;
        if (name === 'history') return history;
        if (name === 'innerWidth') return root ? nativeWindow.innerWidth : host.clientWidth;
        if (name === 'innerHeight') return root ? nativeWindow.innerHeight : host.clientHeight;
        if (name === 'addEventListener' || name === 'removeEventListener' || name === 'dispatchEvent') return events[name].bind(events);
        if (Object.prototype.hasOwnProperty.call(state, name)) {
          if (!root || !(name in methods)) return state[name];
        }
        if (name in methods) return methods[name];
        if (name === 'fetch') return (value, options) => localFetch(value, options, baseURL.href);
        if (name === 'getComputedStyle') return nativeWindow.getComputedStyle.bind(nativeWindow);
        const value = nativeWindow[name];
        return ['scrollTo','scrollBy','matchMedia'].includes(name) ? value.bind(nativeWindow) : value;
      },
      set(_, name, value) { state[name] = value; return true; },
      has(_, name) { return name in state || name in nativeWindow; },
    });
    const environment = {
      window: scopeWindow, document: scopeDocument, location, history, parent: parent || scopeWindow,
      globalThis: scopeWindow, self: scopeWindow,
      fetch: (value, options) => localFetch(value, options, baseURL.href),
      requestAnimationFrame: (...args) => scopeWindow.requestAnimationFrame(...args),
      cancelAnimationFrame: (...args) => scopeWindow.cancelAnimationFrame(...args),
      setTimeout: (...args) => methods.setTimeout(...args),
      clearTimeout: (...args) => methods.clearTimeout(...args),
      setInterval: (...args) => methods.setInterval(...args),
      clearInterval: (...args) => methods.clearInterval(...args),
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      getComputedStyle: nativeWindow.getComputedStyle.bind(nativeWindow),
      Image: function(width, height) { return root ? new nativeWindow.Image(width, height) : patchImage(new nativeWindow.Image(width, height)); },
      resolve: path => new URL(path, base).href,
    };
    const scope = {window: scopeWindow, document: scopeDocument, events, environment,
      async run(descriptor) {
        await Promise.all(descriptor.preload.map(asset));
        if (closed) return;
        baseURL = new URL(descriptor.base, base);
        if (!root) {
          const markup = descriptor.html.replace(/__CVM_ASSET__([^"]+)__/g, (_, key) => dataURL(key));
          shadow.innerHTML = '<style>:host{display:block;contain:style}html,body{display:block;margin:0;width:100%}</style>';
          const parsed = new DOMParser().parseFromString(markup, 'text/html');
          shadow.append(nativeDocument.importNode(parsed.documentElement, true));
          html = shadow.querySelector('html');
          body = shadow.querySelector('body');
          head = shadow.querySelector('head');
          if (!html || !body) throw new Error('Invalid packaged view document');
        }
        await descriptor.run(environment);
        readyState = 'complete';
        emit(documentEvents, 'DOMContentLoaded');
        emit(events, 'load');
      },
      dispose() {
        if (closed) return;
        scopeWindow.behindFrameLifecycle?.dispose();
        scopeWindow.__bfStopLoops?.();
        emit(events, 'pagehide');
        closed = true;
        children.forEach(view => view.remove());
        rafs.forEach(nativeCancelRAF);
        timers.forEach(id => nativeWindow.clearTimeout(id));
        intervals.forEach(id => nativeWindow.clearInterval(id));
      },
    };
    return scope;
  }
  function createView(parentScope) {
    const host = nativeDocument.createElement('cvm-view');
    let source = '', scope;
    const pendingWindow = {__bfErrors: []};
    Object.defineProperties(host, {
      contentWindow: {get: () => scope?.window || pendingWindow},
      contentDocument: {get: () => scope?.document || null},
      width: {set: value => { host.style.width = `${value}px`; }},
      height: {set: value => { host.style.height = `${value}px`; }},
      src: {
        get: () => source,
        set(value) {
          if (source) throw new Error('Create a new view to navigate between cases');
          source = new URL(value, parentScope.document.baseURI).href;
          queueMicrotask(async () => {
            try {
              const key = keyFor(source);
              if (!programs.has(key)) await loadScript(registry.programs[key]);
              const descriptor = programs.get(key);
              if (!descriptor) throw new Error(`View is not packaged: ${key}`);
              if (!host.isConnected) return;
              scope = scopeFor(host, source, parentScope);
              await scope.run(descriptor);
              host.dispatchEvent(new Event('load'));
            } catch (error) {
              console.error(error);
              pendingWindow.__bfErrors.push(error.message);
              if (scope) scope.window.__bfErrors = [...(scope.window.__bfErrors || []), error.message];
              host.dispatchEvent(new Event('error'));
            }
          });
        },
      },
    });
    const remove = host.remove.bind(host);
    host.remove = () => { scope?.dispose(); remove(); };
    return host;
  }
  nativeWindow.CVM = {
    registerAsset(key, data, type) { assets.set(key, {data, type}); },
    registerProgram(key, descriptor) { programs.set(key, descriptor); },
    setRegistry(value) { registry = value; },
    async start(key) {
      try {
        await loadScript('static/compat/registry.js');
        await loadScript(registry.programs[key]);
        const scope = scopeFor(null, nativeWindow.location.href, null, true);
        await scope.run(programs.get(key));
      } catch (error) {
        console.error(error);
        const status = nativeDocument.createElement('p');
        status.setAttribute('role', 'alert');
        status.textContent = `Unable to load the project page: ${error.message}. Please reload to retry.`;
        nativeDocument.body.prepend(status);
      }
    },
  };
})();
