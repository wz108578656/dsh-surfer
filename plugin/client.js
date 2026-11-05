/**
 * dsh-surfer browser half: open .vcd / .fst / .ghw in the right sidebar.
 *
 * Bytes come from workspaceFiles.readBytes in 2 MiB windows. A window is not
 * subject to the 32 MiB complete-file cap, so a large VCD can be assembled in
 * the browser. The assembled Blob is still kept in memory; files above
 * MAX_BYTES (512 MiB) are refused before the read starts. Surfer WASM is not
 * vendored: a same-origin srcdoc iframe imports surfer.js, surfer_bg.wasm, and
 * integration.js from the public Surfer site, then receives the waveform as a
 * blob: URL via LoadUrl. A cross-origin iframe cannot read a blob URL created
 * by this page, so the official site is not embedded directly.
 *
 * Profile-installed bundles are served as browser modules. This file only
 * registers a lazy factory; tab registration happens when the factory runs.
 */
window.__ModuleLoader__.load({
	id: 'dsh-surfer',
	factory(require) {
		const React = require('react');
		const h = React.createElement;

		const ID = 'dsh-surfer/wave';
		const KIND = 'surfer-wave';
		const NS = 'surfer';
		const ASSET_ORIGIN = 'https://app.surfer-project.org';
		/** One readBytes range. Matches the Host default maxBytes; a longer window is refused. */
		const CHUNK_BYTES = 2 * 1024 * 1024;
		/** Largest waveform kept in the tab. The whole file is copied into a Blob for Surfer. */
		const MAX_BYTES = 512 * 1024 * 1024;
		const FILE_ADDRESS_PREFIX = 'dsh-resource://file/';

		const zh = {
			'title': '波形',
			'loading': '正在读取波形…',
			'booting': '正在加载 Surfer…',
			'tooLarge': '文件超过 {limit}，无法在侧栏打开',
			'reading': '正在读取波形… {read} / {total}',
			'unavailable': '读不到这个文件',
			'notSession': '只能打开当前会话工作区里的波形文件',
			'cdn': '加载 Surfer 失败。检查能否访问 {origin}',
			'parse': 'Surfer 无法解析这个波形文件',
			'retry': '重试',
			'reload': '重新加载',
			'openSite': '在 Surfer 网站打开',
		};

		const en = {
			'title': 'Waveform',
			'loading': 'Reading waveform…',
			'booting': 'Loading Surfer…',
			'tooLarge': 'File is larger than {limit} and cannot open in the sidebar',
			'reading': 'Reading waveform… {read} / {total}',
			'unavailable': 'Cannot read this file',
			'notSession': 'Only waveform files in this session workspace can be opened',
			'cdn': 'Surfer failed to load. Check access to {origin}',
			'parse': 'Surfer could not parse this waveform',
			'retry': 'Retry',
			'reload': 'Reload',
			'openSite': 'Open Surfer website',
		};

		function formatBytes(bytes) {
			if (!Number.isFinite(bytes) || bytes < 1024) return `${bytes} B`;
			const units = ['KiB', 'MiB', 'GiB'];
			let value = bytes / 1024;
			let unit = 0;
			while (value >= 1024 && unit < units.length - 1) {
				value /= 1024;
				unit += 1;
			}
			return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
		}

		/**
		 * Parse a dsh-resource://file/ address. Mirrors dsh-util-workspace-path
		 * without importing it: a dynamic client bundle only has the module table.
		 */
		function parseFileAddress(address) {
			try {
				if (typeof address !== 'string' || !address.startsWith(FILE_ADDRESS_PREFIX)) return undefined;
				const end = address.search(/[?#]/);
				const [scope, ...rest] = address.slice(FILE_ADDRESS_PREFIX.length, end === -1 ? undefined : end).split('/');
				if (scope === 'session') {
					const [id, ...segments] = rest;
					if (!id || segments.length === 0) return undefined;
					return {
						scope,
						sessionId: decodeURIComponent(id),
						path: segments.map(decodeURIComponent).join('/'),
					};
				}
				if (scope === 'absolute') return { scope };
				return undefined;
			} catch {
				return undefined;
			}
		}

		/**
		 * Read a whole regular file as ranged windows. Returns the file size and
		 * one copy of its bytes, or `{ tooLarge: true }` when the size is known
		 * and above the cap. A short chunk ends the file; `eof` is trusted when
		 * the Host reports it.
		 */
		async function readWaveBytes(readRange, sessionId, path, signal, onProgress) {
			const parts = [];
			let offset = 0;
			let total = 0;
			let size;
			for (;;) {
				const result = await readRange(sessionId, path, offset, CHUNK_BYTES, signal);
				if (!result.ok) return { ok: false, error: result.error };
				const page = result.value;
				if (size === undefined && typeof page.bytes === 'number' && page.bytes >= 0) size = page.bytes;
				if (size !== undefined && size > MAX_BYTES) return { ok: false, tooLarge: true, bytes: size };
				const data = page.data;
				if (data.byteLength > 0) {
					const copy = new Uint8Array(data.byteLength);
					copy.set(data);
					parts.push(copy);
					total += copy.byteLength;
					if (total > MAX_BYTES) return { ok: false, tooLarge: true, bytes: size ?? total };
				}
				offset += data.byteLength;
				if (onProgress) onProgress(total, size);
				if (page.eof || data.byteLength === 0) break;
				if (size !== undefined && offset >= size) break;
			}
			const body = new Uint8Array(total);
			let cursor = 0;
			for (const part of parts) {
				body.set(part, cursor);
				cursor += part.byteLength;
			}
			return { ok: true, data: body, bytes: total };
		}

		function fileNameOf(path) {
			const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
			return slash === -1 ? path : path.slice(slash + 1);
		}

		/**
		 * The file address a tab body actually receives. The committed record keeps
		 * it on `contentId`; `address` is not a field of that record. Older callers
		 * and the title hook may still pass `navigation.address`, which is the same
		 * string, so both are accepted.
		 */
		function tabAddress(tab) {
			if (tab && typeof tab.contentId === 'string' && tab.contentId) return tab.contentId;
			if (tab && tab.navigation && typeof tab.navigation.address === 'string') return tab.navigation.address;
			if (tab && typeof tab.address === 'string') return tab.address;
			return '';
		}

		function isWaveform(address) {
			const parsed = parseFileAddress(address);
			return parsed?.scope === 'session' && /\.(vcd|fst|ghw)$/i.test(parsed.path);
		}

		/** Same-origin document that boots hosted Surfer WASM and reports ready/error. */
		function wrapperHtml() {
			const boot = JSON.stringify(ASSET_ORIGIN);
			return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; height: 100%; background: #1b1b1d; overflow: hidden; }
  canvas { display: block; width: 100%; height: 100%; }
</style>
</head>
<body>
<canvas id="the_canvas_id"></canvas>
<script type="module">
  const origin = ${boot};
  const fail = (message) => parent.postMessage({ command: 'surfer-error', message: String(message) }, '*');
  try {
    const mod = await import(origin + '/surfer.js');
    await mod.default({ module_or_path: origin + '/surfer_bg.wasm' });
    window.inject_message = mod.inject_message;
    await new Promise((resolve, reject) => {
      const tag = document.createElement('script');
      tag.src = origin + '/integration.js';
      tag.onload = resolve;
      tag.onerror = () => reject(new Error('integration.js'));
      document.body.appendChild(tag);
    });
    if (typeof register_message_listener === 'function') register_message_listener();
    parent.postMessage({ command: 'surfer-ready' }, '*');
  } catch (error) {
    fail(error && error.message ? error.message : error);
  }
</script>
</body>
</html>`;
		}

		const WRAPPER = wrapperHtml();

		function Status({ message, action, onAction, link }) {
			return h('div', {
				style: {
					height: '100%',
					minHeight: 0,
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					justifyContent: 'center',
					gap: '12px',
					padding: '16px',
					boxSizing: 'border-box',
					color: 'var(--dsw-alias-label-secondary)',
					background: 'var(--dsw-alias-bg-primary, transparent)',
					textAlign: 'center',
					fontSize: '13px',
					lineHeight: 1.5,
				},
			},
			h('p', { style: { margin: 0, maxWidth: '36em' } }, message),
			action ? h('button', {
				type: 'button',
				onClick: onAction,
				style: {
					color: 'var(--dsw-alias-label-primary)',
					background: 'var(--dsw-alias-interactive-bg-hover, transparent)',
					border: '1px solid var(--dsw-alias-border-l3, transparent)',
					borderRadius: '6px',
					padding: '4px 10px',
					cursor: 'pointer',
				},
			}, action) : null,
			link ? h('a', {
				href: link.href,
				target: '_blank',
				rel: 'noreferrer',
				style: { color: 'var(--dsw-alias-label-secondary)' },
			}, link.label) : null);
		}

		function WaveBody({ useTabInfo, sessionId, t, readRange }) {
			const { tab } = useTabInfo();
			const address = tabAddress(tab);
			const signal = tab.signal;
			const [phase, setPhase] = React.useState('loading');
			const [progress, setProgress] = React.useState('');
			const [detail, setDetail] = React.useState('');
			const [attempt, setAttempt] = React.useState(0);
			const frameRef = React.useRef(null);
			const blobRef = React.useRef('');
			const tRef = React.useRef(t);
			tRef.current = t;

			const parsed = parseFileAddress(address);
			const file = parsed?.scope === 'session' ? parsed : null;
			const filePath = file?.path ?? '';

			React.useEffect(() => {
				if (!filePath) return undefined;
				const controller = new AbortController();
				const onAbort = () => controller.abort();
				if (signal.aborted) controller.abort();
				else signal.addEventListener('abort', onAbort);
				let cancelled = false;
				let blobUrl = '';
				setPhase('loading');
				setProgress('');
				setDetail('');

				const fail = (next, message) => {
					if (!cancelled) {
						setPhase(next);
						setDetail(message || '');
					}
				};

				const onMessage = (event) => {
					if (cancelled) return;
					const frame = frameRef.current;
					if (!frame || event.source !== frame.contentWindow) return;
					const data = event.data;
					if (!data || typeof data !== 'object') return;
					if (data.command === 'surfer-ready' && blobUrl) {
						frame.contentWindow.postMessage({ command: 'LoadUrl', url: blobUrl }, '*');
						frame.contentWindow.postMessage({ command: 'ToggleMenu' }, '*');
						setPhase('ready');
					} else if (data.command === 'surfer-error') {
						fail('cdn', typeof data.message === 'string' ? data.message : '');
					}
				};
				window.addEventListener('message', onMessage);

				(async () => {
					let result;
					try {
						result = await readWaveBytes(readRange, sessionId, filePath, controller.signal, (read, total) => {
							if (!cancelled) setProgress(tRef.current('reading', {
								read: formatBytes(read),
								total: typeof total === 'number' ? formatBytes(total) : '…',
							}));
						});
					} catch (error) {
						if (!controller.signal.aborted) fail('unavailable', error && error.message);
						return;
					}
					if (cancelled || controller.signal.aborted) return;
					if (!result.ok) {
						if (result.tooLarge || (result.error && result.error.code === 'workspace-file/too-large')) fail('tooLarge');
						else fail('unavailable', result.error && result.error.message);
						return;
					}
					if (result.bytes > MAX_BYTES) {
						fail('tooLarge');
						return;
					}
					blobUrl = URL.createObjectURL(new Blob([result.data], { type: 'application/octet-stream' }));
					blobRef.current = blobUrl;
					if (!cancelled) setPhase('booting');
				})();

				return () => {
					cancelled = true;
					controller.abort();
					signal.removeEventListener('abort', onAbort);
					window.removeEventListener('message', onMessage);
					if (blobUrl) URL.revokeObjectURL(blobUrl);
					if (blobRef.current === blobUrl) blobRef.current = '';
				};
			}, [filePath, sessionId, attempt, signal, readRange]);

			const retry = () => setAttempt((value) => value + 1);
			const site = { href: ASSET_ORIGIN, label: t('openSite') };

			if (!file || phase === 'notSession') {
				return h(Status, { message: t('notSession'), link: site });
			}
			if (phase === 'tooLarge') {
				return h(Status, { message: t('tooLarge', { limit: formatBytes(MAX_BYTES) }), link: site });
			}
			if (phase === 'unavailable') {
				return h(Status, { message: detail || t('unavailable'), action: t('retry'), onAction: retry, link: site });
			}
			if (phase === 'cdn') {
				return h(Status, {
					message: t('cdn', { origin: ASSET_ORIGIN }) + (detail ? ` (${detail})` : ''),
					action: t('retry'),
					onAction: retry,
					link: site,
				});
			}

			const mounted = phase === 'booting' || phase === 'ready';
			return h('div', { style: { position: 'relative', height: '100%', minHeight: 0, background: '#1b1b1d' } },
				phase === 'loading' || phase === 'booting' ? h('div', {
					style: {
						position: 'absolute',
						inset: 0,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						color: '#c8c8c8',
						fontSize: '13px',
						pointerEvents: 'none',
					},
				}, phase === 'booting' ? t('booting') : (progress || t('loading'))) : null,
				phase === 'ready' ? h('button', {
					type: 'button',
					onClick: retry,
					title: t('reload'),
					style: {
						position: 'absolute',
						top: '8px',
						right: '8px',
						zIndex: 2,
						color: '#f2f2f2',
						background: 'rgba(0,0,0,0.45)',
						border: '1px solid rgba(255,255,255,0.2)',
						borderRadius: '6px',
						padding: '3px 8px',
						cursor: 'pointer',
						fontSize: '12px',
					},
				}, t('reload')) : null,
				mounted ? h('iframe', {
					ref: frameRef,
					title: fileNameOf(file.path),
					srcDoc: WRAPPER,
					style: { border: 0, width: '100%', height: '100%', display: 'block' },
				}) : null);
		}

		function WaveTitle({ useTabInfo, t }) {
			const { tab } = useTabInfo();
			const parsed = parseFileAddress(tabAddress(tab));
			const name = parsed?.path ? fileNameOf(parsed.path) : t('title');
			return h('span', null, name);
		}

		return {
			inject: ['slots', 'locale', 'sidebarRightTabs', 'remote', 'remote.workspaceFiles'],
			apply(ctx) {
				ctx.effect(() => ctx.locale.register(NS, { zh, en }));
				const translate = ctx.locale.bind(NS);
				const readRange = (sessionId, path, offset, length, signal) => ctx.remote.workspaceFiles.readBytes(
					sessionId,
					path,
					{ range: { offset, length } },
					signal,
				);
				ctx.effect(() => ctx.sidebarRightTabs.register({
					id: ID,
					kind: KIND,
					multiple: true,
					patterns: ['*.vcd', '*.fst', '*.ghw'],
					priority: 'extension',
					canOpen: isWaveform,
					title: (address) => {
						const parsed = parseFileAddress(address);
						return parsed?.path ? fileNameOf(parsed.path) : translate('title');
					},
				}));
				ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
					name: 'sidebar.right.pane.tab',
					key: ID,
					locale: NS,
					inject: () => ({ readRange }),
				}, WaveBody)));
				ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
					name: 'sidebar.right.pane.tab.title',
					key: ID,
					locale: NS,
				}, WaveTitle)));
			},
		};
	},
});
