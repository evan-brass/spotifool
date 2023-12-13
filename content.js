// Kill any previous service workers
navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(reg => reg.unregister()));

// Wipe the site clean:
document.querySelectorAll(':not(html, body, head, title)').forEach(el => el.remove());
document.querySelectorAll('*').forEach(el => el.getAttributeNames().forEach(attr => el.removeAttribute(attr)));

const script = document.createElement('script');
script.type = 'module';
script.src = (self.browser ?? self.chrome).runtime.getURL('src/index.mjs');
document.body.append(script);
