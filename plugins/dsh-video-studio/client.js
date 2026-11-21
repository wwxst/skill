window.__ModuleLoader__.load({
  id: '@wwxst/dsh-video-studio',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'settings.videoStudio';
    // Cordis loader entry id of this bundle's plugin row (see cordis.patch.yml).
    const ROW_ID = 'video-studio';
    const ORDER = 16;

    const zh = {
      nav: '视频制作',
      title: '视频制作',
      intro: '配置 Video Studio 的素材搜索和图片生成。密钥写入后只保留在 Harness 一侧，不会再回传浏览器。',
      sourceTitle: '素材搜索',
      pixabayKey: 'Pixabay API Key',
      pixabayHint: '用于 Pixabay 素材搜索和下载，保存后立即生效。',
      imageTitle: '图片生成',
      imageModel: '模型名称',
      imageModelHint: '兼容 OpenAI Images API 的模型名称，留空使用默认值。',
      fetchModels: '获取模型',
      fetchingModels: '获取中…',
      modelsLoaded: '已获取模型：',
      modelsFailed: '获取失败：',
      modelsUnreachable: '无法连接本机工作台，请确认图片 API Key 与 Base URL 已保存后重试；',
      modelsPortHint: '（工作台默认 127.0.0.1:4174，改过端口请手动填写）',
      imageBaseUrl: 'Base URL',
      imageBaseUrlHint: '图片生成服务地址，留空使用官方地址。',
      imageKey: 'API Key',
      imageHint: '调用图片生成服务，可能产生费用。',
      configured: '已配置',
      notConfigured: '未配置',
      keepBlank: '已配置，留空表示不修改',
      placeholderSecret: '粘贴 API Key',
      clear: '清除',
      save: '保存',
      saving: '保存中…',
      saved: '已保存',
      saveFailed: '没有全部保存成功，请检查后重试。',
      loading: '正在读取配置…',
      unavailable: '该插件当前未启用，暂时无法配置。',
      readOnly: '本部署的配置为只读。',
      configFileHint: '允许导入目录、端口、数据目录和 ffmpeg 路径属于启动期配置，请用右上角「打开配置文件」修改。',
    };

    const en = {
      nav: 'Video studio',
      title: 'Video studio',
      intro: 'Configure media search and image generation. Keys stay on the Harness side and are never sent back to the browser.',
      sourceTitle: 'Media search',
      pixabayKey: 'Pixabay API key',
      pixabayHint: 'Used for Pixabay search and download; applies as soon as you save.',
      imageTitle: 'Image generation',
      imageModel: 'Model',
      imageModelHint: 'A model name for the OpenAI Images API; empty uses the default.',
      fetchModels: 'Fetch models',
      fetchingModels: 'Fetching…',
      modelsLoaded: 'Models found: ',
      modelsFailed: 'Could not fetch models: ',
      modelsUnreachable: 'Could not reach the local workbench. Confirm the image API key and base URL are saved, then retry. ',
      modelsPortHint: ' (the workbench defaults to 127.0.0.1:4174; type the name if you changed the port)',
      imageBaseUrl: 'Base URL',
      imageBaseUrlHint: 'Image service address; empty uses the official endpoint.',
      imageKey: 'API key',
      imageHint: 'Calls the image service and may incur charges.',
      configured: 'Configured',
      notConfigured: 'Not configured',
      keepBlank: 'Configured; leave blank to keep it',
      placeholderSecret: 'Paste the API key',
      clear: 'Clear',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved',
      saveFailed: 'Some values were not accepted. Check them and try again.',
      loading: 'Reading configuration…',
      unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
      readOnly: 'This deployment stores configuration read-only.',
      configFileHint: 'Import roots, port, data directory, and ffmpeg paths are startup settings; edit them through Open configuration file.',
    };

    const FIELDS = [
      { key: 'pixabayApiKey', group: 'source', kind: 'secret', label: 'pixabayKey', hint: 'pixabayHint' },
      { key: 'imageModel', group: 'image', kind: 'text', label: 'imageModel', hint: 'imageModelHint' },
      { key: 'imageApiBaseUrl', group: 'image', kind: 'text', label: 'imageBaseUrl', hint: 'imageBaseUrlHint' },
      { key: 'imageApiKey', group: 'image', kind: 'secret', label: 'imageKey', hint: 'imageHint' },
    ];

    const GROUPS = [
      { id: 'source', title: 'sourceTitle' },
      { id: 'image', title: 'imageTitle' },
    ];

    const styles = {
      section: {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        maxWidth: '760px',
        color: 'var(--dsw-alias-label-primary)',
      },
      heading: { margin: 0, fontSize: '18px', fontWeight: 600 },
      intro: { margin: 0, fontSize: '13px', color: 'var(--dsw-alias-label-tertiary)' },
      group: { display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '6px' },
      groupTitle: { margin: 0, fontSize: '15px', fontWeight: 600, lineHeight: '22px' },
      field: { display: 'flex', flexDirection: 'column', gap: '4px' },
      labelRow: { display: 'flex', alignItems: 'baseline', gap: '8px', fontSize: '13px' },
      badge: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' },
      input: {
        boxSizing: 'border-box',
        width: '100%',
        font: 'inherit',
        fontSize: '13px',
        padding: '7px 10px',
        borderRadius: '6px',
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-l2, transparent)',
        border: '0.5px solid var(--dsw-alias-border-l2)',
      },
      hint: { margin: 0, fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' },
      footer: { display: 'flex', alignItems: 'center', gap: '12px', marginTop: '8px' },
      button: {
        font: 'inherit',
        fontSize: '13px',
        padding: '6px 14px',
        borderRadius: '6px',
        cursor: 'pointer',
        color: 'var(--dsw-alias-label-primary)',
        background: 'transparent',
        border: '0.5px solid var(--dsw-alias-border-l2)',
      },
      primary: {
        font: 'inherit',
        fontSize: '13px',
        padding: '6px 14px',
        borderRadius: '6px',
        cursor: 'pointer',
        border: '0',
        color: 'var(--dsw-alias-label-inverse, #fff)',
        background: 'var(--dsw-alias-state-business-primary, #247bbf)',
      },
      note: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' },
    };

    // The workbench server performs the /models request with the stored key; the
    // browser never sees the key and no provider CORS policy has to allow us.
    const WORKBENCH_URL = 'http://127.0.0.1:4174';
    const MODEL_LIST_ID = 'video-studio-image-models';

    /** Load JSON through a <script> tag: exempt from CORS, preflight, and PNA. */
    function loadModelsViaJsonp(url, timeoutMs = 8000) {
      return new Promise((resolve, reject) => {
        const name = 'vsModels_' + Math.random().toString(36).slice(2);
        const script = document.createElement('script');
        let settled = false;
        const cleanup = () => {
          try { delete window[name]; } catch { window[name] = undefined; }
          if (script.parentNode) script.parentNode.removeChild(script);
        };
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(new Error('timeout'));
        }, timeoutMs);
        window[name] = (payload) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          cleanup();
          resolve(payload);
        };
        script.onerror = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          cleanup();
          reject(new Error('script error'));
        };
        script.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + name;
        document.head.appendChild(script);
      });
    }

    async function loadModelList() {
      try {
        const response = await fetch(WORKBENCH_URL + '/api/image-models', { headers: { accept: 'application/json' } });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error((payload && payload.error) || ('HTTP ' + response.status));
        return payload;
      } catch (error) {
        // Some browsers and proxies refuse the cross-origin fetch outright; the
        // script-tag path reaches the same loopback endpoint without CORS.
        const payload = await loadModelsViaJsonp(WORKBENCH_URL + '/api/image-models');
        if (payload && payload.error) throw new Error(payload.error);
        return payload;
      }
    }

    function Field({ t, field, value, draft, disabled, onChange, onClear, options, action, note }) {
      const isSecret = field.kind === 'secret';
      const configured = isSecret && value !== undefined && value !== null && value !== '';
      const current = Object.prototype.hasOwnProperty.call(draft, field.key)
        ? draft[field.key]
        : isSecret ? '' : value === undefined || value === null ? '' : Array.isArray(value) ? value.join('\n') : String(value);
      const placeholder = isSecret ? (configured ? t('keepBlank') : t('placeholderSecret')) : '';
      const rows = field.kind === 'list' ? Math.max(2, String(current).split('\n').length) : undefined;
      const control = field.kind === 'list'
        ? h('textarea', {
          style: { ...styles.input, resize: 'vertical', fontFamily: 'inherit' },
          rows,
          value: current,
          disabled,
          placeholder: 'D:\\Media',
          onChange: (event) => onChange(field.key, event.target.value),
        })
        : h('input', {
          style: styles.input,
          type: isSecret ? 'password' : field.kind === 'number' ? 'number' : 'text',
          value: current,
          disabled,
          autoComplete: 'off',
          list: options && options.length ? MODEL_LIST_ID : undefined,
          placeholder,
          onChange: (event) => onChange(field.key, event.target.value),
        });
      return h('div', { style: styles.field },
        h('div', { style: styles.labelRow },
          h('span', null, t(field.label)),
          isSecret ? h('span', { style: styles.badge }, configured ? t('configured') : t('notConfigured')) : null,
          isSecret && configured && !disabled
            ? h('button', { type: 'button', style: styles.button, onClick: () => onClear(field.key) }, t('clear'))
            : null,
          action
            ? h('button', {
              type: 'button',
              style: styles.button,
              disabled: disabled || action.busy,
              onClick: action.onClick,
            }, action.busy ? action.busyLabel : action.label)
            : null,
        ),
        control,
        options && options.length
          ? h('datalist', { id: MODEL_LIST_ID }, options.map((option) => h('option', { key: option, value: option })))
          : null,
        h('p', { style: styles.hint }, note || t(field.hint)),
      );
    }

    function createSection(ctx, t) {
      let form;
      let formError;
      try {
        form = ctx.configForms.get(ROW_ID);
      } catch (error) {
        formError = error instanceof Error ? error.message : String(error);
      }

      const subscribe = (listener) => (form ? form.subscribe(listener) : () => {});
      const getSnapshot = () => (form ? form.getSnapshot() : { status: 'unavailable' });

      return function VideoStudioSettings(props) {
        const translate = props && typeof props.t === 'function' ? props.t : t;
        const snapshot = React.useSyncExternalStore(subscribe, getSnapshot);
        const [draft, setDraft] = React.useState({});
        const [busy, setBusy] = React.useState(false);
        const [note, setNote] = React.useState(null);
        const [models, setModels] = React.useState([]);
        const [modelsBusy, setModelsBusy] = React.useState(false);
        const [modelNote, setModelNote] = React.useState(null);

        const loadModels = async () => {
          if (modelsBusy) return;
          setModelsBusy(true);
          setModelNote(null);
          try {
            const payload = await loadModelList();
            const list = payload && Array.isArray(payload.models) ? payload.models : [];
            setModels(list);
            setModelNote(translate('modelsLoaded') + list.length);
          } catch (error) {
            setModels([]);
            const message = error && error.message ? error.message : String(error);
            // A CORS or connection failure surfaces as a bare "Failed to fetch",
            // which says nothing actionable; name the likely cause instead.
            const detail = /fetch|network|cors/i.test(message)
              ? translate('modelsUnreachable')
              : translate('modelsFailed') + message;
            setModelNote(detail + translate('modelsPortHint'));
          } finally {
            setModelsBusy(false);
          }
        };

        const status = snapshot.status;
        const writable = snapshot.writable !== false;
        const value = snapshot.value || {};

        const change = (key, text) => {
          setNote(null);
          setDraft((previous) => ({ ...previous, [key]: text }));
        };

        const save = async () => {
          if (!form || busy) return;
          setBusy(true);
          setNote(null);
          let failed = false;
          try {
            for (const field of FIELDS) {
              if (!Object.prototype.hasOwnProperty.call(draft, field.key)) continue;
              const text = String(draft[field.key] ?? '').trim();
              let accepted = true;
              if (field.kind === 'secret') {
                if (text === '') continue;
                accepted = await form.set(field.key, text);
              } else if (field.kind === 'number') {
                if (text === '') accepted = await form.unset(field.key) !== false;
                else {
                  const parsed = Number(text);
                  if (!Number.isFinite(parsed)) accepted = false;
                  else accepted = await form.set(field.key, parsed);
                }
              } else if (field.kind === 'list') {
                const items = text.split(/\r?\n|;|,/).map((item) => item.trim()).filter(Boolean);
                accepted = items.length === 0 ? await form.unset(field.key) !== false : await form.set(field.key, items);
              } else if (text === '') {
                accepted = await form.unset(field.key) !== false;
              } else {
                accepted = await form.set(field.key, text);
              }
              if (!accepted) failed = true;
            }
            setDraft({});
            setNote(failed ? translate('saveFailed') : translate('saved'));
          } catch (error) {
            setNote(translate('saveFailed'));
          } finally {
            setBusy(false);
          }
        };

        const clearField = async (key) => {
          if (!form || busy) return;
          setBusy(true);
          setNote(null);
          try {
            const accepted = await form.unset(key) !== false;
            setNote(accepted ? translate('saved') : translate('saveFailed'));
          } catch (error) {
            setNote(translate('saveFailed'));
          } finally {
            setBusy(false);
          }
        };

        const children = [];
        children.push(h('h2', { key: 'heading', style: styles.heading }, translate('title')));
        children.push(h('p', { key: 'intro', style: styles.intro }, translate('intro')));

        if (formError) {
          children.push(h('p', { key: 'form-error', style: styles.hint }, translate('unavailable')));
          return h('div', { style: styles.section }, children);
        }
        if (status === 'loading' || status === 'idle') {
          children.push(h('p', { key: 'loading', style: styles.hint }, translate('loading')));
          return h('div', { style: styles.section }, children);
        }
        if (status === 'unavailable') {
          children.push(h('p', { key: 'unavailable', style: styles.hint }, translate('unavailable')));
          return h('div', { style: styles.section }, children);
        }
        if (!writable) {
          children.push(h('p', { key: 'read-only', style: styles.hint }, translate('readOnly')));
        }

        const disabled = busy || !writable;
        for (const group of GROUPS) {
          const fields = FIELDS.filter((field) => field.group === group.id);
          children.push(h('div', { key: group.id, style: styles.group },
            h('h3', { style: styles.groupTitle }, translate(group.title)),
            ...fields.map((field) => h(Field, {
              key: field.key,
              t: translate,
              field,
              value: value[field.key],
              draft,
              disabled,
              onChange: change,
              onClear: clearField,
              options: field.key === 'imageModel' ? models : undefined,
              note: field.key === 'imageModel' ? modelNote : undefined,
              action: field.key === 'imageModel' ? {
                label: translate('fetchModels'),
                busyLabel: translate('fetchingModels'),
                busy: modelsBusy,
                onClick: () => { void loadModels(); },
              } : undefined,
            })),
          ));
        }

        children.push(h('div', { key: 'footer', style: styles.footer },
          h('button', {
            type: 'button',
            style: styles.primary,
            disabled,
            onClick: () => { void save(); },
          }, busy ? translate('saving') : translate('save')),
          note === null ? null : h('span', { style: styles.note }, note),
        ));
        children.push(h('p', { key: 'config-file', style: styles.hint }, translate('configFileHint')));

        return h('div', { style: styles.section }, children);
      };
    }

    return {
      inject: ['slots', 'locale', 'configForms'],
      apply(ctx) {
        const t = ctx.locale.bind(NS);
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'video-studio: settings dictionaries');
        const Section = createSection(ctx, t);
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'video-studio',
          order: ORDER,
          label: () => t('nav'),
          locale: NS,
        }, Section));
      },
    };
  },
});
