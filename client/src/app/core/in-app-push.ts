import { escapeHtml } from './dom';

export interface InAppPushOptions {
  title?: string;
  message: string;
  icon?: string;
  actionText?: string;
  actionHref?: string;
  actionTarget?: string;
  actionCallback?: () => void;
  durationMs?: number;
}

const toastQueue: InAppPushOptions[] = [];
let isShowingToast = false;
let pushToastTimer: ReturnType<typeof setTimeout> | undefined;

function getToastElement(): HTMLElement {
  let el = document.getElementById('in-app-push-toast');
  if (!el) {
    const existing = document.getElementById('driver-toast');
    if (existing) {
      el = existing;
      el.id = 'in-app-push-toast';
    } else {
      el = document.createElement('div');
      el.id = 'in-app-push-toast';
      el.className = 'driver-toast';
      el.setAttribute('role', 'alert');
      el.setAttribute('aria-live', 'assertive');
      el.setAttribute('aria-atomic', 'true');
      document.body.appendChild(el);
    }
  }
  return el;
}

function processQueue(): void {
  if (isShowingToast || toastQueue.length === 0) return;
  const opts = toastQueue.shift();
  if (!opts) return;

  isShowingToast = true;
  const el = getToastElement();

  const icon = opts.icon || '🔔';
  const titleHtml = opts.title ? `<strong class="driver-toast-title">${escapeHtml(opts.title)}</strong>` : '';
  const messageHtml = `<span class="driver-toast-msg">${escapeHtml(opts.message)}</span>`;
  const actionTarget = opts.actionTarget || opts.actionHref || '';
  const actionHtml = opts.actionText
    ? `<a href="${actionTarget || '#'}" class="driver-toast-action" ${opts.actionTarget?.startsWith('#') ? `data-scroll data-target="${opts.actionTarget}"` : ''}>${escapeHtml(opts.actionText)}</a>`
    : '';

  el.innerHTML = `
    <span class="driver-toast-icon">${icon}</span>
    <div class="driver-toast-body">
      ${titleHtml}
      ${messageHtml}
    </div>
    ${actionHtml}
    <button class="driver-toast-close" id="push-toast-close" aria-label="Cerrar aviso">✕</button>
  `;

  if (opts.actionCallback && actionHtml) {
    el.querySelector('.driver-toast-action')?.addEventListener('click', (e) => {
      e.preventDefault();
      opts.actionCallback?.();
    }, { once: true });
  }

  if (actionTarget?.startsWith('#')) {
    el.querySelector('.driver-toast-action')?.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelector(actionTarget)?.scrollIntoView({ behavior: 'smooth' });
    });
  }

  el.classList.add('driver-toast--visible');
  clearTimeout(pushToastTimer);

  const duration = opts.durationMs ?? 7500;

  const dismiss = () => {
    clearTimeout(pushToastTimer);
    el.classList.remove('driver-toast--visible');
    setTimeout(() => {
      isShowingToast = false;
      processQueue();
    }, 280);
  };

  pushToastTimer = setTimeout(dismiss, duration);

  el.querySelector('#push-toast-close')?.addEventListener('click', dismiss, { once: true });
}

/**
 * Muestra una notificación emergente tipo Push en la esquina superior derecha
 * de la aplicación web con soporte de cola para evitar sobreescritura accidental.
 */
export function showInAppPush(options: InAppPushOptions | string): void {
  const opts: InAppPushOptions = typeof options === 'string' ? { message: options } : options;
  toastQueue.push(opts);
  processQueue();
}
