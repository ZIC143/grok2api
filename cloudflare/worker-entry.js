function json(data, init = {}) {
  return Response.json(data, {
    headers: {
      'cache-control': 'no-store',
      ...(init.headers || {}),
    },
    ...init,
  });
}

function unauthorized(detail) {
  return json(
    {
      detail,
    },
    {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Bearer',
      },
    }
  );
}

const CONFIG_KEY = 'grok2api:config:runtime';
const FLAGS_KEY = 'grok2api:runtime:flags';
const NOTES_KEY = 'grok2api:runtime:notes';

const MODEL_CATALOG = [
  { id: 'grok-3', owned_by: 'grok2api@cloudflare', mode: 'chat', tier: 'basic', cost: 'low' },
  { id: 'grok-3-mini', owned_by: 'grok2api@cloudflare', mode: 'chat', tier: 'basic', cost: 'low' },
  { id: 'grok-3-thinking', owned_by: 'grok2api@cloudflare', mode: 'chat', tier: 'basic', cost: 'low' },
  { id: 'grok-4', owned_by: 'grok2api@cloudflare', mode: 'chat', tier: 'basic', cost: 'low' },
  { id: 'grok-4-thinking', owned_by: 'grok2api@cloudflare', mode: 'chat', tier: 'basic', cost: 'low' },
  { id: 'grok-4-heavy', owned_by: 'grok2api@cloudflare', mode: 'chat', tier: 'super', cost: 'high' },
  { id: 'grok-4.1-mini', owned_by: 'grok2api@cloudflare', mode: 'chat', tier: 'basic', cost: 'low' },
  { id: 'grok-4.1-fast', owned_by: 'grok2api@cloudflare', mode: 'chat', tier: 'basic', cost: 'low' },
  { id: 'grok-4.1-expert', owned_by: 'grok2api@cloudflare', mode: 'chat', tier: 'basic', cost: 'high' },
  { id: 'grok-4.1-thinking', owned_by: 'grok2api@cloudflare', mode: 'chat', tier: 'basic', cost: 'high' },
  { id: 'grok-4.20-beta', owned_by: 'grok2api@cloudflare', mode: 'chat', tier: 'basic', cost: 'low' },
  { id: 'grok-imagine-1.0-fast', owned_by: 'grok2api@cloudflare', mode: 'image', tier: 'basic', cost: 'high' },
  { id: 'grok-imagine-1.0', owned_by: 'grok2api@cloudflare', mode: 'image', tier: 'basic', cost: 'high' },
  { id: 'grok-imagine-1.0-edit', owned_by: 'grok2api@cloudflare', mode: 'image_edit', tier: 'basic', cost: 'high' },
  { id: 'grok-imagine-1.0-video', owned_by: 'grok2api@cloudflare', mode: 'video', tier: 'basic', cost: 'high' },
];

function getModelCatalogResponse() {
  return MODEL_CATALOG.map((model) => ({
    id: model.id,
    object: 'model',
    created: 0,
    owned_by: model.owned_by,
    metadata: {
      mode: model.mode,
      tier: model.tier,
      cost: model.cost,
      runtime: 'cloudflare-workers-bridge',
    },
  }));
}

function getModelsByMode(mode) {
  return getModelCatalogResponse().filter((model) => model.metadata?.mode === mode);
}

function getConfigSummary(config) {
  return {
    sections: Object.keys(config),
    app: {
      function_enabled: Boolean(config.app?.function_enabled),
      image_format: config.app?.image_format || 'url',
      video_format: config.app?.video_format || 'html',
      temporary: Boolean(config.app?.temporary),
      disable_memory: Boolean(config.app?.disable_memory),
      stream: Boolean(config.app?.stream),
      thinking: Boolean(config.app?.thinking),
    },
    proxy: {
      enabled: Boolean(config.proxy?.enabled),
      has_base_proxy_url: Boolean(config.proxy?.base_proxy_url),
      has_asset_proxy_url: Boolean(config.proxy?.asset_proxy_url),
      has_cf_clearance: Boolean(config.proxy?.cf_clearance),
    },
    token: {
      auto_refresh: Boolean(config.token?.auto_refresh),
      refresh_interval_hours: config.token?.refresh_interval_hours,
      super_refresh_interval_hours: config.token?.super_refresh_interval_hours,
    },
    runtime: config.runtime || {},
  };
}

function getFunctionAccessSummary(config) {
  const functionEnabled = Boolean(config.app?.function_enabled);
  const functionKey = String(config.app?.function_key || '').trim();
  return {
    enabled: functionEnabled,
    auth_required: Boolean(functionKey),
    public_access: functionEnabled && !functionKey,
  };
}

function getChatInitConfig(config) {
  const chatModels = getModelsByMode('chat')
    .map((model) => model.id)
    .filter((id) => !String(id).includes('video'));
  const defaultModel = chatModels.includes('grok-4.20-beta')
    ? 'grok-4.20-beta'
    : chatModels[chatModels.length - 1] || 'grok-4.20-beta';

  return {
    status: 'ok',
    scene: 'chat',
    access: getFunctionAccessSummary(config),
    bridge: getChatBridgeSummary(config),
    defaults: {
      model: defaultModel,
      temperature: 0.8,
      top_p: 0.95,
      stream: Boolean(config.app?.stream),
      thinking: Boolean(config.app?.thinking),
      disable_memory: Boolean(config.app?.disable_memory),
      temporary: Boolean(config.app?.temporary),
      custom_instruction: String(config.app?.custom_instruction || ''),
      max_context_messages: 5,
    },
    models: {
      preferred: defaultModel,
      available: chatModels,
    },
    capabilities: {
      attachments: true,
      multi_session: true,
      stream_request_supported: false,
      worker_bridge_mode: 'init-only',
    },
  };
}

function getImagineInitConfig(config) {
  return {
    status: 'ok',
    scene: 'imagine',
    access: getFunctionAccessSummary(config),
    final_min_bytes: Number(config.image?.final_min_bytes || 0),
    medium_min_bytes: Number(config.image?.medium_min_bytes || 0),
    nsfw: Boolean(config.image?.nsfw),
    defaults: {
      aspect_ratio: '2:3',
      nsfw: Boolean(config.image?.nsfw),
      response_format: String(config.imagine_fast?.response_format || 'url'),
      size: String(config.imagine_fast?.size || '1024x1024'),
      n: Number(config.imagine_fast?.n || 1),
      blocked_parallel_enabled: Boolean(config.image?.blocked_parallel_enabled),
      blocked_parallel_attempts: Number(config.image?.blocked_parallel_attempts || 0),
    },
    options: {
      aspect_ratios: ['1:1', '2:3', '3:2', '9:16', '16:9'],
      response_formats: ['url', 'b64_json', 'base64'],
      sizes: ['1024x1024', '1280x720', '720x1280', '1792x1024', '1024x1792'],
    },
    capabilities: {
      ws_supported: false,
      sse_supported: false,
      start_supported: false,
      worker_bridge_mode: 'init-only',
    },
  };
}

function getVideoInitConfig(config) {
  return {
    status: 'ok',
    scene: 'video',
    access: getFunctionAccessSummary(config),
    defaults: {
      aspect_ratio: '3:2',
      video_length: 6,
      resolution_name: '480p',
      preset: 'normal',
      reasoning_effort: 'low',
      image_url_required: false,
    },
    options: {
      aspect_ratios: ['16:9', '9:16', '3:2', '2:3', '1:1'],
      video_lengths: [6, 10, 15, 20, 30],
      resolution_names: ['480p', '720p'],
      presets: ['fun', 'normal', 'spicy', 'custom'],
      reasoning_efforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
    },
    models: {
      available: getModelsByMode('video').map((model) => model.id),
    },
    capabilities: {
      sse_supported: false,
      start_supported: false,
      worker_bridge_mode: 'init-only',
    },
  };
}

function getFunctionBootstrapConfig(config) {
  return {
    status: 'ok',
    access: getFunctionAccessSummary(config),
    chat: getChatInitConfig(config),
    imagine: getImagineInitConfig(config),
    video: getVideoInitConfig(config),
  };
}

function getTaskCapabilitySummary(config) {
  return {
    status: 'ok',
    worker_bridge_mode: 'read-only-capability-probe',
    scenes: {
      chat: {
        enabled: true,
        execution_supported: true,
        init_supported: true,
        models_supported: true,
        attachment_supported: true,
        streaming_supported: false,
        max_context_messages: 5,
        bridge: getChatBridgeSummary(config),
      },
      imagine: {
        enabled: getFunctionAccessSummary(config).enabled,
        execution_supported: false,
        init_supported: true,
        ws_supported: false,
        sse_supported: false,
        download_supported: false,
        concurrent_hint: Number(config.image?.blocked_parallel_attempts || 1),
      },
      video: {
        enabled: getFunctionAccessSummary(config).enabled,
        execution_supported: false,
        init_supported: true,
        sse_supported: false,
        image_reference_supported: true,
        reasoning_effort_supported: true,
      },
    },
  };
}

function getTaskLimitSummary(config) {
  return {
    status: 'ok',
    limits: {
      chat: {
        temperature: { min: 0, max: 2, default: 0.8 },
        top_p: { min: 0, max: 1, default: 0.95 },
        reasoning_efforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
      },
      imagine: {
        aspect_ratios: ['1:1', '2:3', '3:2', '9:16', '16:9'],
        response_formats: ['url', 'b64_json', 'base64'],
        sizes: ['1024x1024', '1280x720', '720x1280', '1792x1024', '1024x1792'],
        final_min_bytes: Number(config.image?.final_min_bytes || 0),
        medium_min_bytes: Number(config.image?.medium_min_bytes || 0),
      },
      video: {
        aspect_ratios: ['16:9', '9:16', '3:2', '2:3', '1:1'],
        video_length: { min: 6, max: 30, defaults: [6, 10, 15, 20, 30] },
        resolution_names: ['480p', '720p'],
        presets: ['fun', 'normal', 'spicy', 'custom'],
        reasoning_efforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
      },
    },
  };
}

function getTaskRestrictionSummary(config) {
  return {
    status: 'ok',
    restrictions: {
      runtime: [
        'no-long-running-jobs',
        'no-stream-pass-through',
        'no-websocket-bridge',
        'no-file-upload-bridge',
      ],
      chat: [
        'chat-completions-not-bridged',
        'streaming-disabled-in-worker-bridge',
      ],
      imagine: [
        'start-stop-not-bridged',
        'ws-disabled-in-worker-bridge',
        'sse-disabled-in-worker-bridge',
      ],
      video: [
        'start-stop-not-bridged',
        'sse-disabled-in-worker-bridge',
        'generation-disabled-in-worker-bridge',
      ],
      access: getFunctionAccessSummary(config),
    },
  };
}

function buildFieldSchema(field) {
  return field;
}

function withFieldUiMeta(field, ui) {
  return {
    ...field,
    ui,
  };
}

function buildSectionMeta(section) {
  return section;
}

function getChatFormSchema(config) {
  const chatInit = getChatInitConfig(config);
  return {
    status: 'ok',
    scene: 'chat',
    endpoint: '/v1/function/chat/completions',
    method: 'POST',
    submit_supported: true,
    bridge: getChatBridgeSummary(config),
    examples: {
      minimal: {
        model: chatInit.defaults.model,
        messages: [{ role: 'user', content: '你好，帮我总结今天的待办。' }],
      },
      full: {
        model: chatInit.defaults.model,
        stream: false,
        temperature: 0.8,
        top_p: 0.95,
        reasoning_effort: 'low',
        messages: [{ role: 'user', content: '请解释 Cloudflare Workers 的适用边界。' }],
      },
    },
    fields: [
      withFieldUiMeta(buildFieldSchema({ name: 'model', type: 'select', required: true, options: chatInit.models.available, default: chatInit.defaults.model }), { label: '模型', description: '选择对话模型', widget: 'chip-select', group: 'basic', order: 10, width: 'full' }),
      withFieldUiMeta(buildFieldSchema({ name: 'messages', type: 'array', required: true, item_type: 'message', min_items: 1 }), { label: '消息列表', description: '至少包含一条用户消息', widget: 'message-editor', group: 'content', order: 20, width: 'full' }),
      withFieldUiMeta(buildFieldSchema({ name: 'stream', type: 'boolean', required: false, default: false, disabled: true }), { label: '流式输出', description: '当前 Worker 桥接层只提供只读 schema，不支持提交执行', widget: 'switch', group: 'advanced', order: 50, width: 'half' }),
      withFieldUiMeta(buildFieldSchema({ name: 'temperature', type: 'number', required: false, min: 0, max: 2, step: 0.1, default: 0.8 }), { label: 'Temperature', description: '采样温度，值越高越发散', widget: 'range', group: 'advanced', order: 30, width: 'half' }),
      withFieldUiMeta(buildFieldSchema({ name: 'top_p', type: 'number', required: false, min: 0, max: 1, step: 0.05, default: 0.95 }), { label: 'Top P', description: 'Nucleus sampling 参数', widget: 'range', group: 'advanced', order: 40, width: 'half' }),
      withFieldUiMeta(buildFieldSchema({ name: 'reasoning_effort', type: 'select', required: false, options: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'], default: 'low' }), { label: '推理强度', description: '控制模型推理深度', widget: 'segmented-select', group: 'advanced', order: 60, width: 'half' }),
    ],
    sections: [
      buildSectionMeta({ id: 'basic', label: '基础设置', description: '模型与主要输入', layout: 'grid', columns: 1 }),
      buildSectionMeta({ id: 'content', label: '内容输入', description: '消息与提示词', layout: 'stack', columns: 1 }),
      buildSectionMeta({ id: 'advanced', label: '高级参数', description: '采样与推理参数', layout: 'grid', columns: 2 }),
    ],
    ui: {
      title: '聊天表单 Schema',
      description: '供前端动态渲染聊天输入区域',
      layout: 'stack',
      submit_label: '发送',
    },
  };
}

function getImagineFormSchema(config) {
  const imagineInit = getImagineInitConfig(config);
  return {
    status: 'ok',
    scene: 'imagine',
    endpoint: '/v1/function/imagine/start',
    method: 'POST',
    submit_supported: false,
    examples: {
      minimal: {
        prompt: '一只戴着宇航头盔的橘猫',
        aspect_ratio: imagineInit.defaults.aspect_ratio,
      },
      full: {
        prompt: '赛博朋克城市上空飞行的鲸鱼',
        aspect_ratio: imagineInit.defaults.aspect_ratio,
        nsfw: imagineInit.defaults.nsfw,
      },
    },
    fields: [
      withFieldUiMeta(buildFieldSchema({ name: 'prompt', type: 'string', required: true, min_length: 1, widget: 'textarea' }), { label: '提示词', description: '输入图像生成提示词', widget: 'textarea', group: 'content', order: 10, width: 'full' }),
      withFieldUiMeta(buildFieldSchema({ name: 'aspect_ratio', type: 'select', required: false, options: imagineInit.options.aspect_ratios, default: imagineInit.defaults.aspect_ratio }), { label: '画面比例', description: '选择生成图片比例', widget: 'select', group: 'basic', order: 20, width: 'half' }),
      withFieldUiMeta(buildFieldSchema({ name: 'nsfw', type: 'boolean', required: false, default: imagineInit.defaults.nsfw }), { label: 'NSFW', description: '是否启用 NSFW 模式', widget: 'switch', group: 'basic', order: 30, width: 'half' }),
    ],
    sections: [
      buildSectionMeta({ id: 'content', label: '内容输入', description: '图像提示词输入', layout: 'stack', columns: 1 }),
      buildSectionMeta({ id: 'basic', label: '基础选项', description: '比例与模式', layout: 'grid', columns: 2 }),
    ],
    ui: {
      title: 'Imagine 表单 Schema',
      description: '供前端动态渲染图像生成参数区域',
      layout: 'stack',
      submit_label: '开始生成',
    },
  };
}

function getVideoFormSchema(config) {
  const videoInit = getVideoInitConfig(config);
  return {
    status: 'ok',
    scene: 'video',
    endpoint: '/v1/function/video/start',
    method: 'POST',
    submit_supported: false,
    examples: {
      minimal: {
        prompt: '海边黄昏的慢镜头',
        aspect_ratio: videoInit.defaults.aspect_ratio,
        video_length: videoInit.defaults.video_length,
      },
      full: {
        prompt: '雨夜街头穿行的无人车',
        aspect_ratio: videoInit.defaults.aspect_ratio,
        video_length: videoInit.defaults.video_length,
        resolution_name: videoInit.defaults.resolution_name,
        preset: videoInit.defaults.preset,
        reasoning_effort: videoInit.defaults.reasoning_effort,
        image_url: 'https://example.com/reference.png',
      },
    },
    fields: [
      withFieldUiMeta(buildFieldSchema({ name: 'prompt', type: 'string', required: true, min_length: 1, widget: 'textarea' }), { label: '提示词', description: '输入视频生成提示词', widget: 'textarea', group: 'content', order: 10, width: 'full' }),
      withFieldUiMeta(buildFieldSchema({ name: 'aspect_ratio', type: 'select', required: false, options: videoInit.options.aspect_ratios, default: videoInit.defaults.aspect_ratio }), { label: '画面比例', description: '视频输出比例', widget: 'select', group: 'basic', order: 20, width: 'half' }),
      withFieldUiMeta(buildFieldSchema({ name: 'video_length', type: 'select', required: false, options: videoInit.options.video_lengths, default: videoInit.defaults.video_length }), { label: '视频时长', description: '单位秒', widget: 'select', group: 'basic', order: 30, width: 'half' }),
      withFieldUiMeta(buildFieldSchema({ name: 'resolution_name', type: 'select', required: false, options: videoInit.options.resolution_names, default: videoInit.defaults.resolution_name }), { label: '分辨率', description: '视频输出分辨率', widget: 'select', group: 'quality', order: 40, width: 'half' }),
      withFieldUiMeta(buildFieldSchema({ name: 'preset', type: 'select', required: false, options: videoInit.options.presets, default: videoInit.defaults.preset }), { label: '预设风格', description: '生成风格预设', widget: 'select', group: 'quality', order: 50, width: 'half' }),
      withFieldUiMeta(buildFieldSchema({ name: 'reasoning_effort', type: 'select', required: false, options: videoInit.options.reasoning_efforts, default: videoInit.defaults.reasoning_effort }), { label: '推理强度', description: '影响视频生成推理深度', widget: 'segmented-select', group: 'advanced', order: 60, width: 'half' }),
      withFieldUiMeta(buildFieldSchema({ name: 'image_url', type: 'string', required: false, format: 'url-or-data-uri' }), { label: '参考图 URL', description: '可选，支持 URL 或 data URI', widget: 'url-input', group: 'content', order: 70, width: 'full' }),
    ],
    sections: [
      buildSectionMeta({ id: 'content', label: '内容输入', description: '提示词与参考图', layout: 'stack', columns: 1 }),
      buildSectionMeta({ id: 'basic', label: '基础选项', description: '比例与时长', layout: 'grid', columns: 2 }),
      buildSectionMeta({ id: 'quality', label: '质量设置', description: '分辨率与风格', layout: 'grid', columns: 2 }),
      buildSectionMeta({ id: 'advanced', label: '高级参数', description: '推理相关设置', layout: 'grid', columns: 2 }),
    ],
    ui: {
      title: 'Video 表单 Schema',
      description: '供前端动态渲染视频生成参数区域',
      layout: 'stack',
      submit_label: '开始生成',
    },
  };
}

function getTaskSchemaIndex(config) {
  return {
    status: 'ok',
    version: 'phase-d',
    schemas: {
      chat: '/v1/function/schema/chat',
      imagine: '/v1/function/schema/imagine',
      video: '/v1/function/schema/video',
    },
    scenes: {
      chat: getChatFormSchema(config),
      imagine: getImagineFormSchema(config),
      video: getVideoFormSchema(config),
    },
  };
}

function getTaskUiHints(config) {
  return {
    status: 'ok',
    version: 'phase-e',
    scenes: {
      chat: {
        title: '聊天面板',
        icon: 'message-square',
        preferred_layout: 'sidebar-main',
        submit_label: '发送',
        sections: getChatFormSchema(config).sections,
      },
      imagine: {
        title: 'Imagine 面板',
        icon: 'image',
        preferred_layout: 'toolbar-main',
        submit_label: '开始生成',
        sections: getImagineFormSchema(config).sections,
      },
      video: {
        title: 'Video 面板',
        icon: 'film',
        preferred_layout: 'toolbar-main',
        submit_label: '开始生成',
        sections: getVideoFormSchema(config).sections,
      },
    },
  };
}

function getFunctionAssemblyManifest(config) {
  const chatSchema = getChatFormSchema(config);
  const imagineSchema = getImagineFormSchema(config);
  const videoSchema = getVideoFormSchema(config);
  const uiHints = getTaskUiHints(config);
  const capabilities = getTaskCapabilitySummary(config);
  const limits = getTaskLimitSummary(config);
  const restrictions = getTaskRestrictionSummary(config);
  const bootstrap = getFunctionBootstrapConfig(config);

  return {
    status: 'ok',
    version: 'phase-f',
    runtime: {
      worker_bridge_mode: 'frontend-assembly-manifest',
      submit_supported: true,
      chat_bridge: getChatBridgeSummary(config),
    },
    endpoints: {
      bootstrap: '/v1/function/bootstrap',
      capabilities: '/v1/function/capabilities',
      limits: '/v1/function/limits',
      restrictions: '/v1/function/restrictions',
      schema_index: '/v1/function/schema',
      ui_hints: '/v1/function/ui-hints',
    },
    scenes: {
      chat: {
        bootstrap: bootstrap.chat,
        capabilities: capabilities.scenes.chat,
        limits: limits.limits.chat,
        restrictions: restrictions.restrictions.chat,
        schema: chatSchema,
        ui: uiHints.scenes.chat,
      },
      imagine: {
        bootstrap: bootstrap.imagine,
        capabilities: capabilities.scenes.imagine,
        limits: limits.limits.imagine,
        restrictions: restrictions.restrictions.imagine,
        schema: imagineSchema,
        ui: uiHints.scenes.imagine,
      },
      video: {
        bootstrap: bootstrap.video,
        capabilities: capabilities.scenes.video,
        limits: limits.limits.video,
        restrictions: restrictions.restrictions.video,
        schema: videoSchema,
        ui: uiHints.scenes.video,
      },
    },
  };
}

const DEFAULT_RUNTIME_CONFIG = {
  app: {
    app_url: '',
    app_key: 'grok2api',
    api_key: '',
    function_enabled: false,
    function_key: '',
    image_format: 'url',
    video_format: 'html',
    temporary: true,
    disable_memory: true,
    stream: true,
    thinking: true,
    dynamic_statsig: true,
    custom_instruction: '',
    filter_tags: ['xaiartifact', 'xai:tool_usage_card', 'grok:render'],
  },
  proxy: {
    base_proxy_url: '',
    asset_proxy_url: '',
    cf_cookies: '',
    skip_proxy_ssl_verify: false,
    enabled: false,
    flaresolverr_url: '',
    refresh_interval: 3600,
    timeout: 60,
    cf_clearance: '',
    browser: 'chrome136',
    user_agent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  },
  retry: {
    max_retry: 3,
    retry_status_codes: [401, 429, 403],
    reset_session_status_codes: [403],
    retry_backoff_base: 0.5,
    retry_backoff_factor: 2,
    retry_backoff_max: 20,
    retry_budget: 60,
  },
  token: {
    auto_refresh: true,
    refresh_interval_hours: 8,
    super_refresh_interval_hours: 2,
    fail_threshold: 5,
    save_delay_ms: 500,
    usage_flush_interval_sec: 5,
    reload_interval_sec: 30,
  },
  cache: {
    enable_auto_clean: true,
    limit_mb: 512,
  },
  chat: {
    concurrent: 50,
    timeout: 60,
    stream_timeout: 60,
  },
  image: {
    timeout: 60,
    stream_timeout: 60,
    final_timeout: 15,
    blocked_grace_seconds: 10,
    nsfw: true,
    medium_min_bytes: 30000,
    final_min_bytes: 100000,
    blocked_parallel_attempts: 5,
    blocked_parallel_enabled: true,
  },
  imagine_fast: {
    n: 1,
    size: '1024x1024',
    response_format: 'url',
  },
  video: {
    concurrent: 100,
    timeout: 60,
    stream_timeout: 60,
    upscale_timing: 'complete',
  },
  voice: {
    timeout: 60,
  },
  asset: {
    upload_concurrent: 100,
    upload_timeout: 60,
    download_concurrent: 100,
    download_timeout: 60,
    list_concurrent: 100,
    list_timeout: 60,
    list_batch_size: 50,
    delete_concurrent: 100,
    delete_timeout: 60,
    delete_batch_size: 50,
  },
  nsfw: {
    concurrent: 60,
    batch_size: 30,
    timeout: 60,
  },
  usage: {
    concurrent: 100,
    batch_size: 50,
    timeout: 60,
  },
  runtime: {
    app_name: 'grok2api',
    environment: 'unknown',
    runtime: 'cloudflare-workers',
  },
};

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function timingSafeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') {
    return false;
  }

  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    diff |= leftBytes[index] ^ rightBytes[index];
  }
  return diff === 0;
}

function getBearerToken(request) {
  const authorization = request.headers.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function normalizeApiKeys(value) {
  if (!value) {
    return [];
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  return [];
}

async function verifyAdminRequest(request, env) {
  const runtimeConfig = await getRuntimeConfig(env);
  const appKey = String(runtimeConfig.config.app?.app_key || '').trim();
  const token = getBearerToken(request);

  if (!appKey) {
    return {
      ok: false,
      response: unauthorized('App key is not configured'),
      runtimeConfig,
    };
  }

  if (!token) {
    return {
      ok: false,
      response: unauthorized('Missing authentication token'),
      runtimeConfig,
    };
  }

  if (!timingSafeEqual(token, appKey)) {
    return {
      ok: false,
      response: unauthorized('Invalid authentication token'),
      runtimeConfig,
    };
  }

  return { ok: true, runtimeConfig, token };
}

async function verifyFunctionRequest(request, env) {
  const runtimeConfig = await getRuntimeConfig(env);
  const functionKey = String(runtimeConfig.config.app?.function_key || '').trim();
  const functionEnabled = Boolean(runtimeConfig.config.app?.function_enabled);
  const token = getBearerToken(request);

  if (!functionKey) {
    if (functionEnabled) {
      return { ok: true, runtimeConfig, token: '' };
    }
    return {
      ok: false,
      response: unauthorized('Function access is disabled'),
      runtimeConfig,
    };
  }

  if (!token) {
    return {
      ok: false,
      response: unauthorized('Missing authentication token'),
      runtimeConfig,
    };
  }

  if (!timingSafeEqual(token, functionKey)) {
    return {
      ok: false,
      response: unauthorized('Invalid authentication token'),
      runtimeConfig,
    };
  }

  return { ok: true, runtimeConfig, token };
}

async function handleFunctionChatCompletions(request, env) {
  const auth = await verifyFunctionRequest(request, env);
  if (!auth.ok) {
    return auth.response;
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ detail: 'invalid-json' }, { status: 400 });
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return json({ detail: 'payload-must-be-object' }, { status: 400 });
  }

  if (!payload.model || !Array.isArray(payload.messages) || payload.messages.length === 0) {
    return json(
      {
        detail: 'model-and-messages-required',
        message: 'Chat bridge requires model and at least one message',
        code: 'invalid_chat_payload',
      },
      { status: 400 }
    );
  }

  const requestedStream = payload.stream !== undefined
    ? Boolean(payload.stream)
    : Boolean(auth.runtimeConfig.config.app?.stream);
  const bridge = getChatBridgeSummary(auth.runtimeConfig.config);

  if (requestedStream) {
    return json(
      {
        status: 'error',
        message: 'streaming-disabled-in-worker-bridge',
        code: 'stream_not_supported',
      },
      { status: 400 }
    );
  }

  if (bridge.configured) {
    try {
      const backendUrl = new URL(bridge.backend_url);
      if (!/^https?:$/i.test(backendUrl.protocol)) {
        throw new Error('invalid_backend_protocol');
      }
      const targetUrl = new URL('/v1/chat/completions', backendUrl);
      const backendApiKey = normalizeApiKeys(auth.runtimeConfig.config.app?.api_key)[0] || '';
      const forwardHeaders = new Headers({
        'content-type': 'application/json',
        accept: 'application/json',
        'x-grok2api-chat-bridge': 'backend-forward',
      });
      if (backendApiKey) {
        forwardHeaders.set('authorization', `Bearer ${backendApiKey}`);
      }
      const response = await fetch(targetUrl.toString(), {
        method: 'POST',
        headers: forwardHeaders,
        body: JSON.stringify(payload),
      });

      const contentType = response.headers.get('content-type') || 'application/json';
      const backendTraceId = response.headers.get('x-trace-id') || '';
      const retryAfter = response.headers.get('retry-after') || '';
      const bodyText = await response.text();
      const responseHeaders = new Headers({
        'content-type': contentType,
        'cache-control': 'no-store',
        'x-grok2api-chat-bridge': 'backend-forward',
      });
      if (backendTraceId) {
        responseHeaders.set('x-grok2api-backend-trace-id', backendTraceId);
      }
      if (retryAfter) {
        responseHeaders.set('retry-after', retryAfter);
      }
      return new Response(bodyText, {
        status: response.status,
        headers: responseHeaders,
      });
    } catch (error) {
      return json(
        {
          status: 'error',
          message: 'chat-bridge-forward-failed',
          code: 'bridge_forward_failed',
          detail: String(error && error.message ? error.message : error),
          bridge,
        },
        { status: 502 }
      );
    }
  }

  return json({
    status: 'accepted',
    scene: 'chat',
    bridge_mode: 'phase-i-non-stream-probe',
    bridge,
    submit_supported: true,
    execution_supported: true,
    streaming_supported: false,
    request_echo: {
      model: payload.model || null,
      message_count: Array.isArray(payload.messages) ? payload.messages.length : 0,
      reasoning_effort: payload.reasoning_effort || null,
      temperature: payload.temperature ?? null,
      top_p: payload.top_p ?? null,
    },
  }, {
    headers: {
      'x-grok2api-chat-bridge': 'probe',
    },
  });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return deepClone(override);
  }

  const result = deepClone(base);
  for (const [key, value] of Object.entries(override)) {
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = deepClone(value);
    }
  }
  return result;
}

function buildDefaultConfig(env) {
  const config = deepClone(DEFAULT_RUNTIME_CONFIG);
  config.runtime.app_name = env.APP_NAME || 'grok2api';
  config.runtime.environment = env.APP_ENV || 'unknown';
  config.app.app_url = env.APP_URL || '';
  config.runtime.chat_bridge_backend_url = env.CHAT_BRIDGE_BACKEND_URL || '';
  return config;
}

function getChatBridgeSummary(config) {
  const backendUrl = String(config.runtime?.chat_bridge_backend_url || '').trim();
  return {
    configured: Boolean(backendUrl),
    backend_url: backendUrl,
    mode: backendUrl ? 'backend-forward-ready' : 'probe-only',
  };
}

function pruneUnknownConfig(config, defaults) {
  if (!isPlainObject(config)) {
    return { config: {}, removed: { __root__: ['<section>'] } };
  }

  const pruned = {};
  const removed = {};

  for (const [section, value] of Object.entries(config)) {
    if (!(section in defaults)) {
      removed[section] = ['<section>'];
      continue;
    }

    const defaultSection = defaults[section];
    if (isPlainObject(defaultSection) && isPlainObject(value)) {
      const kept = {};
      const removedKeys = [];
      for (const [key, sectionValue] of Object.entries(value)) {
        if (key in defaultSection) {
          kept[key] = sectionValue;
        } else {
          removedKeys.push(key);
        }
      }
      if (Object.keys(kept).length > 0) {
        pruned[section] = kept;
      }
      if (removedKeys.length > 0) {
        removed[section] = removedKeys;
      }
      continue;
    }

    pruned[section] = value;
  }

  return { config: pruned, removed };
}

function migrateLegacyConfig(config) {
  if (!isPlainObject(config)) {
    return { config: {}, migrated: {} };
  }

  const next = deepClone(config);
  const migrated = {};
  const mapping = {
    'grok.temporary': 'app.temporary',
    'grok.disable_memory': 'app.disable_memory',
    'grok.stream': 'app.stream',
    'grok.thinking': 'app.thinking',
    'grok.dynamic_statsig': 'app.dynamic_statsig',
    'grok.filter_tags': 'app.filter_tags',
    'grok.base_proxy_url': 'proxy.base_proxy_url',
    'grok.asset_proxy_url': 'proxy.asset_proxy_url',
    'grok.cf_clearance': 'proxy.cf_clearance',
    'grok.browser': 'proxy.browser',
    'grok.user_agent': 'proxy.user_agent',
    'security.cf_clearance': 'proxy.cf_clearance',
    'security.browser': 'proxy.browser',
    'security.user_agent': 'proxy.user_agent',
    'network.base_proxy_url': 'proxy.base_proxy_url',
    'network.asset_proxy_url': 'proxy.asset_proxy_url',
  };

  for (const [source, target] of Object.entries(mapping)) {
    const [sourceSection, sourceKey] = source.split('.');
    const [targetSection, targetKey] = target.split('.');
    if (!isPlainObject(next[sourceSection])) {
      continue;
    }
    if (!(sourceKey in next[sourceSection])) {
      continue;
    }
    if (!isPlainObject(next[targetSection])) {
      next[targetSection] = {};
    }
    if (!(targetKey in next[targetSection])) {
      next[targetSection][targetKey] = next[sourceSection][sourceKey];
      migrated[source] = target;
    }
    delete next[sourceSection][sourceKey];
    if (Object.keys(next[sourceSection]).length === 0) {
      delete next[sourceSection];
    }
  }

  if (isPlainObject(next.chat)) {
    const legacyChatMap = {
      temporary: 'temporary',
      disable_memory: 'disable_memory',
      stream: 'stream',
      thinking: 'thinking',
      dynamic_statsig: 'dynamic_statsig',
      filter_tags: 'filter_tags',
    };
    if (!isPlainObject(next.app)) {
      next.app = {};
    }
    for (const [oldKey, newKey] of Object.entries(legacyChatMap)) {
      if (oldKey in next.chat && !(newKey in next.app)) {
        next.app[newKey] = next.chat[oldKey];
        migrated[`chat.${oldKey}`] = `app.${newKey}`;
        delete next.chat[oldKey];
      }
    }
    if (Object.keys(next.chat).length === 0) {
      delete next.chat;
    }
  }

  return { config: next, migrated };
}

function normalizeConfig(env, candidate) {
  const defaults = buildDefaultConfig(env);
  const migratedResult = migrateLegacyConfig(candidate);
  const prunedResult = pruneUnknownConfig(migratedResult.config, defaults);
  const merged = deepMerge(defaults, prunedResult.config);

  return {
    config: merged,
    migrated: migratedResult.migrated,
    removed: prunedResult.removed,
    defaults,
  };
}

async function ensureD1Schema(env) {
  if (!(env.DB && typeof env.DB.prepare === 'function')) {
    return { ok: false, detail: 'binding-missing' };
  }

  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS worker_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`
    ).run();
    return { ok: true, detail: 'schema-ready' };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function upsertWorkerState(env, key, value) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO worker_state (key, value, updated_at)
     VALUES (?1, ?2, ?3)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  )
    .bind(key, JSON.stringify(value), now)
    .run();
}

async function getWorkerState(env, key) {
  const row = await env.DB.prepare(
    'SELECT key, value, updated_at FROM worker_state WHERE key = ?1'
  )
    .bind(key)
    .first();

  if (!row) {
    return null;
  }

  let parsedValue = row.value;
  try {
    parsedValue = JSON.parse(row.value);
  } catch {
    // keep raw string value
  }

  return {
    key: row.key,
    value: parsedValue,
    updated_at: row.updated_at,
  };
}

async function getRuntimeConfig(env) {
  const defaultConfig = buildDefaultConfig(env);

  if (!(env.KV_CACHE && typeof env.KV_CACHE.get === 'function')) {
    return {
      source: 'default',
      config: defaultConfig,
      migrated: {},
      removed: {},
    };
  }

  const stored = await env.KV_CACHE.get(CONFIG_KEY, { type: 'json' });
  if (stored && typeof stored === 'object') {
    const normalized = normalizeConfig(env, stored);
    return {
      source: 'kv',
      config: normalized.config,
      migrated: normalized.migrated,
      removed: normalized.removed,
    };
  }

  return {
    source: 'default',
    config: defaultConfig,
    migrated: {},
    removed: {},
  };
}

async function saveRuntimeConfig(env, payload) {
  if (!(env.KV_CACHE && typeof env.KV_CACHE.put === 'function')) {
    return { ok: false, detail: 'kv-binding-missing' };
  }

  await env.KV_CACHE.put(CONFIG_KEY, JSON.stringify(payload));
  return { ok: true, detail: 'config-saved' };
}

async function getRuntimeFlags(env) {
  const defaults = {
    bridge_readonly: false,
    maintenance_mode: false,
    models_bridge_enabled: true,
  };

  if (!(env.KV_CACHE && typeof env.KV_CACHE.get === 'function')) {
    return { source: 'default', flags: defaults };
  }

  const stored = await env.KV_CACHE.get(FLAGS_KEY, { type: 'json' });
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return { source: 'default', flags: defaults };
  }

  return {
    source: 'kv',
    flags: {
      ...defaults,
      ...stored,
    },
  };
}

async function saveRuntimeFlags(env, flags) {
  if (!(env.KV_CACHE && typeof env.KV_CACHE.put === 'function')) {
    return { ok: false, detail: 'kv-binding-missing' };
  }

  await env.KV_CACHE.put(FLAGS_KEY, JSON.stringify(flags));
  return { ok: true, detail: 'flags-saved' };
}

async function deleteRuntimeFlags(env) {
  if (!(env.KV_CACHE && typeof env.KV_CACHE.delete === 'function')) {
    return { ok: false, detail: 'kv-binding-missing' };
  }

  await env.KV_CACHE.delete(FLAGS_KEY);
  return { ok: true, detail: 'flags-deleted' };
}

async function getRuntimeNotes(env) {
  const defaults = {
    note: '',
    updated_at: '',
  };

  if (!(env.KV_CACHE && typeof env.KV_CACHE.get === 'function')) {
    return { source: 'default', notes: defaults };
  }

  const stored = await env.KV_CACHE.get(NOTES_KEY, { type: 'json' });
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return { source: 'default', notes: defaults };
  }

  return {
    source: 'kv',
    notes: {
      ...defaults,
      ...stored,
    },
  };
}

async function saveRuntimeNotes(env, notes) {
  if (!(env.KV_CACHE && typeof env.KV_CACHE.put === 'function')) {
    return { ok: false, detail: 'kv-binding-missing' };
  }

  await env.KV_CACHE.put(NOTES_KEY, JSON.stringify(notes));
  return { ok: true, detail: 'notes-saved' };
}

async function deleteRuntimeNotes(env) {
  if (!(env.KV_CACHE && typeof env.KV_CACHE.delete === 'function')) {
    return { ok: false, detail: 'kv-binding-missing' };
  }

  await env.KV_CACHE.delete(NOTES_KEY);
  return { ok: true, detail: 'notes-deleted' };
}

async function getStorageSnapshot(env) {
  const schema = await ensureD1Schema(env);
  const runtimeConfig = await getRuntimeConfig(env);
  const snapshot = {
    environment: env.APP_ENV || 'unknown',
    app_name: env.APP_NAME || 'grok2api',
    kv: {
      available: Boolean(env.KV_CACHE),
      config_source: runtimeConfig.source,
      config_key: CONFIG_KEY,
    },
    d1: {
      available: Boolean(env.DB),
      schema,
      state: null,
    },
    config: runtimeConfig.config,
  };

  if (schema.ok) {
    const current = await getWorkerState(env, 'runtime_config');
    if (!current) {
      await upsertWorkerState(env, 'runtime_config', runtimeConfig.config);
      snapshot.d1.state = await getWorkerState(env, 'runtime_config');
    } else {
      snapshot.d1.state = current;
    }
  }

  return snapshot;
}

async function runStorageCheck(env) {
  const result = {
    d1: { available: false, ok: false, detail: '' },
    kv: { available: false, ok: false, detail: '' },
  };

  if (env.DB && typeof env.DB.prepare === 'function') {
    result.d1.available = true;
    try {
      const schema = await ensureD1Schema(env);
      if (!schema.ok) {
        result.d1.detail = schema.detail;
        result.ok = false;
        return result;
      }
      const row = await env.DB.prepare('SELECT 1 AS ok').first();
      result.d1.ok = Number(row?.ok) === 1;
      result.d1.detail = result.d1.ok ? 'query-ok' : 'unexpected-result';
    } catch (error) {
      result.d1.detail = error instanceof Error ? error.message : String(error);
    }
  } else {
    result.d1.detail = 'binding-missing';
  }

  if (env.KV_CACHE && typeof env.KV_CACHE.get === 'function') {
    result.kv.available = true;
    const key = `grok2api:health:${crypto.randomUUID()}`;
    try {
      await env.KV_CACHE.put(key, 'ok', { expirationTtl: 60 });
      const value = await env.KV_CACHE.get(key);
      await env.KV_CACHE.delete(key);
      result.kv.ok = value === 'ok';
      result.kv.detail = result.kv.ok ? 'roundtrip-ok' : 'unexpected-value';
    } catch (error) {
      result.kv.detail = error instanceof Error ? error.message : String(error);
    }
  } else {
    result.kv.detail = 'binding-missing';
  }

  result.ok = result.d1.ok && result.kv.ok;
  return result;
}

async function getRuntimeStatus(env) {
  const [runtimeConfig, snapshot, checks, runtimeFlags, runtimeNotes] = await Promise.all([
    getRuntimeConfig(env),
    getStorageSnapshot(env),
    runStorageCheck(env),
    getRuntimeFlags(env),
    getRuntimeNotes(env),
  ]);

  return {
    app: env.APP_NAME || 'grok2api',
    environment: env.APP_ENV || 'unknown',
    source: runtimeConfig.source,
    migrated: runtimeConfig.migrated,
    removed: runtimeConfig.removed,
    flags: runtimeFlags,
    notes: runtimeNotes,
    checks,
    storage: snapshot,
  };
}

async function getOpenAIMetadata(env) {
  const runtimeConfig = await getRuntimeConfig(env);
  return {
    object: 'service',
    id: 'grok2api-cloudflare-workers',
    created: 0,
    owned_by: 'grok2api@cloudflare',
    version: 'bridge-v1',
    runtime: {
      name: 'cloudflare-workers',
      environment: env.APP_ENV || 'unknown',
      source: runtimeConfig.source,
    },
    endpoints: {
      models: '/v1/models',
      model_detail: '/v1/models/:id',
      admin_verify: '/v1/admin/verify',
      function_verify: '/v1/function/verify',
      admin_config: '/v1/admin/config',
      function_bootstrap: '/v1/function/bootstrap',
      function_chat_config: '/v1/function/chat/config',
      function_imagine_config: '/v1/function/imagine/config',
      function_video_config: '/v1/function/video/config',
      function_capabilities: '/v1/function/capabilities',
      function_limits: '/v1/function/limits',
      function_restrictions: '/v1/function/restrictions',
      function_schema_index: '/v1/function/schema',
      function_schema_chat: '/v1/function/schema/chat',
      function_schema_imagine: '/v1/function/schema/imagine',
      function_schema_video: '/v1/function/schema/video',
      function_ui_hints: '/v1/function/ui-hints',
      function_manifest: '/v1/function/manifest',
      runtime_status: '/v1/runtime/status',
      runtime_checks: '/v1/runtime/checks',
      runtime_storage: '/v1/runtime/storage',
      config_summary: '/v1/config/summary',
      metadata: '/v1/metadata',
    },
    capabilities: {
      models_list: true,
      model_detail: true,
      admin_verify: true,
      function_verify: true,
      admin_config: true,
      function_bootstrap: true,
      function_chat_config: true,
      function_imagine_config: true,
      function_video_config: true,
      function_capabilities: true,
      function_limits: true,
      function_restrictions: true,
      function_schema_index: true,
      function_schema_chat: true,
      function_schema_imagine: true,
      function_schema_video: true,
      function_ui_hints: true,
      function_manifest: true,
      runtime_status: true,
      runtime_checks: true,
      runtime_storage: true,
      config_summary: true,
      config_write: true,
      responses_bridge: false,
      chat_bridge: true,
      image_bridge: false,
      video_bridge: false,
    },
  };
        'non-stream-chat-bridge-only',

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({
        status: 'ok',
        runtime: 'cloudflare-workers',
        environment: env.APP_ENV || 'unknown',
        bindings: {
          d1: Boolean(env.DB),
          kv: Boolean(env.KV_CACHE),
        },
      });
    }

    if (url.pathname === '/ready') {
      const checks = await runStorageCheck(env);
      return json(
        {
          status: checks.ok ? 'ok' : 'degraded',
          runtime: 'cloudflare-workers',
          environment: env.APP_ENV || 'unknown',
          checks,
        },
        { status: checks.ok ? 200 : 503 }
      );
    }

    if (url.pathname === '/meta') {
      const runtimeConfig = await getRuntimeConfig(env);
      return json({
        app: env.APP_NAME || 'grok2api',
        runtime: 'cloudflare-workers',
        environment: env.APP_ENV || 'unknown',
        endpoints: ['/health', '/ready', '/meta', '/config', '/storage', '/config/sections', '/v1/admin/verify', '/v1/admin/config', '/v1/function/verify', '/v1/function/bootstrap', '/v1/function/chat/config', '/v1/function/imagine/config', '/v1/function/video/config', '/v1/function/capabilities', '/v1/function/limits', '/v1/function/restrictions', '/v1/function/schema', '/v1/function/schema/chat', '/v1/function/schema/imagine', '/v1/function/schema/video', '/v1/function/ui-hints', '/v1/function/manifest', '/v1/models', '/v1/models/:id', '/v1/runtime/status', '/v1/runtime/checks', '/v1/runtime/storage', '/v1/config/summary', '/v1/metadata'],
        sections: Object.keys(runtimeConfig.config),
      });
    }

    if (url.pathname === '/v1/admin/verify' && request.method === 'GET') {
      const auth = await verifyAdminRequest(request, env);
      if (!auth.ok) {
        return auth.response;
      }
      return json({ status: 'success' });
    }

    if (url.pathname === '/v1/function/verify' && request.method === 'GET') {
      const auth = await verifyFunctionRequest(request, env);
      if (!auth.ok) {
        return auth.response;
      }
      return json({ status: 'success' });
    }

    if (url.pathname === '/v1/function/bootstrap' && request.method === 'GET') {
      const runtimeConfig = await getRuntimeConfig(env);
      return json(getFunctionBootstrapConfig(runtimeConfig.config));
    }

    if (url.pathname === '/v1/function/chat/config' && request.method === 'GET') {
      const runtimeConfig = await getRuntimeConfig(env);
      return json(getChatInitConfig(runtimeConfig.config));
    }

    if (url.pathname === '/v1/function/imagine/config' && request.method === 'GET') {
      const runtimeConfig = await getRuntimeConfig(env);
      return json(getImagineInitConfig(runtimeConfig.config));
    }

    if (url.pathname === '/v1/function/video/config' && request.method === 'GET') {
      const runtimeConfig = await getRuntimeConfig(env);
      return json(getVideoInitConfig(runtimeConfig.config));
    }

    if (url.pathname === '/v1/function/capabilities' && request.method === 'GET') {
      const runtimeConfig = await getRuntimeConfig(env);
      return json(getTaskCapabilitySummary(runtimeConfig.config));
    }

    if (url.pathname === '/v1/function/limits' && request.method === 'GET') {
      const runtimeConfig = await getRuntimeConfig(env);
      return json(getTaskLimitSummary(runtimeConfig.config));
    }

    if (url.pathname === '/v1/function/restrictions' && request.method === 'GET') {
      const runtimeConfig = await getRuntimeConfig(env);
      return json(getTaskRestrictionSummary(runtimeConfig.config));
    }

    if (url.pathname === '/v1/function/schema' && request.method === 'GET') {
      const runtimeConfig = await getRuntimeConfig(env);
      return json(getTaskSchemaIndex(runtimeConfig.config));
    }

    if (url.pathname === '/v1/function/schema/chat' && request.method === 'GET') {
      const runtimeConfig = await getRuntimeConfig(env);
      return json(getChatFormSchema(runtimeConfig.config));
    }

    if (url.pathname === '/v1/function/schema/imagine' && request.method === 'GET') {
      const runtimeConfig = await getRuntimeConfig(env);
      return json(getImagineFormSchema(runtimeConfig.config));
    }

    if (url.pathname === '/v1/function/schema/video' && request.method === 'GET') {
      const runtimeConfig = await getRuntimeConfig(env);
      return json(getVideoFormSchema(runtimeConfig.config));
    }

    if (url.pathname === '/v1/function/ui-hints' && request.method === 'GET') {
      const runtimeConfig = await getRuntimeConfig(env);
      return json(getTaskUiHints(runtimeConfig.config));
    }

    if (url.pathname === '/v1/function/manifest' && request.method === 'GET') {
      const runtimeConfig = await getRuntimeConfig(env);
      return json(getFunctionAssemblyManifest(runtimeConfig.config));
    }

    if (url.pathname === '/v1/function/chat/completions' && request.method === 'POST') {
      return handleFunctionChatCompletions(request, env);
    }

    if (url.pathname === '/v1/admin/config' && request.method === 'GET') {
      const auth = await verifyAdminRequest(request, env);
      if (!auth.ok) {
        return auth.response;
      }
      return json(auth.runtimeConfig.config);
    }

    if (url.pathname === '/v1/admin/config' && request.method === 'POST') {
      const auth = await verifyAdminRequest(request, env);
      if (!auth.ok) {
        return auth.response;
      }

      let payload;
      try {
        payload = await request.json();
      } catch {
        return json({ detail: 'invalid-json' }, { status: 400 });
      }

      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return json({ detail: 'payload-must-be-object' }, { status: 400 });
      }

      const normalized = normalizeConfig(env, deepMerge(auth.runtimeConfig.config, payload));
      const nextConfig = normalized.config;
      nextConfig.runtime = {
        ...nextConfig.runtime,
        updated_at: new Date().toISOString(),
      };

      const saveResult = await saveRuntimeConfig(env, nextConfig);
      if (!saveResult.ok) {
        return json({ detail: saveResult.detail }, { status: 503 });
      }

      const schema = await ensureD1Schema(env);
      if (schema.ok) {
        await upsertWorkerState(env, 'runtime_config', nextConfig);
      }

      return json({ status: 'success', message: '配置已更新', config: nextConfig });
    }

    if (url.pathname === '/v1/models' && request.method === 'GET') {
      return json({
        object: 'list',
        data: getModelCatalogResponse(),
      });
    }

    if (url.pathname.startsWith('/v1/models/') && request.method === 'GET') {
      const modelId = decodeURIComponent(url.pathname.slice('/v1/models/'.length));
      const model = getModelCatalogResponse().find((item) => item.id === modelId);
      if (!model) {
        return json({ status: 'error', message: 'model-not-found', model: modelId }, { status: 404 });
      }
      return json(model);
    }

    if (url.pathname === '/v1/runtime/status' && request.method === 'GET') {
      const status = await getRuntimeStatus(env);
      return json({ status: 'ok', runtime: status });
    }

    if (url.pathname === '/v1/runtime/checks' && request.method === 'GET') {
      const checks = await runStorageCheck(env);
      return json({ status: checks.ok ? 'ok' : 'degraded', checks });
    }

    if (url.pathname === '/v1/runtime/flags' && request.method === 'GET') {
      const runtimeFlags = await getRuntimeFlags(env);
      return json({ status: 'ok', source: runtimeFlags.source, flags: runtimeFlags.flags });
    }

    if (url.pathname === '/v1/runtime/flags' && request.method === 'POST') {
      let payload;
      try {
        payload = await request.json();
      } catch {
        return json({ status: 'error', message: 'invalid-json' }, { status: 400 });
      }

      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return json({ status: 'error', message: 'payload-must-be-object' }, { status: 400 });
      }

      const current = await getRuntimeFlags(env);
      const nextFlags = {
        ...current.flags,
        ...payload,
        updated_at: new Date().toISOString(),
      };
      const saveResult = await saveRuntimeFlags(env, nextFlags);
      if (!saveResult.ok) {
        return json({ status: 'error', message: saveResult.detail }, { status: 503 });
      }

      const schema = await ensureD1Schema(env);
      if (schema.ok) {
        await upsertWorkerState(env, 'runtime_flags', nextFlags);
      }

      return json({ status: 'ok', flags: nextFlags });
    }

    if (url.pathname === '/v1/runtime/flags/reset' && request.method === 'POST') {
      const deleteResult = await deleteRuntimeFlags(env);
      if (!deleteResult.ok) {
        return json({ status: 'error', message: deleteResult.detail }, { status: 503 });
      }

      const resetFlags = (await getRuntimeFlags(env)).flags;
      const schema = await ensureD1Schema(env);
      if (schema.ok) {
        await upsertWorkerState(env, 'runtime_flags', {
          ...resetFlags,
          updated_at: new Date().toISOString(),
          reset: true,
        });
      }

      return json({ status: 'ok', reset: true, flags: resetFlags });
    }

    if (url.pathname === '/v1/runtime/notes' && request.method === 'GET') {
      const runtimeNotes = await getRuntimeNotes(env);
      return json({ status: 'ok', source: runtimeNotes.source, notes: runtimeNotes.notes });
    }

    if (url.pathname === '/v1/runtime/notes' && request.method === 'POST') {
      let payload;
      try {
        payload = await request.json();
      } catch {
        return json({ status: 'error', message: 'invalid-json' }, { status: 400 });
      }

      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return json({ status: 'error', message: 'payload-must-be-object' }, { status: 400 });
      }

      const current = await getRuntimeNotes(env);
      const nextNotes = {
        ...current.notes,
        ...payload,
        updated_at: new Date().toISOString(),
      };

      if (typeof nextNotes.note !== 'string') {
        return json({ status: 'error', message: 'note-must-be-string' }, { status: 400 });
      }

      const saveResult = await saveRuntimeNotes(env, nextNotes);
      if (!saveResult.ok) {
        return json({ status: 'error', message: saveResult.detail }, { status: 503 });
      }

      const schema = await ensureD1Schema(env);
      if (schema.ok) {
        await upsertWorkerState(env, 'runtime_notes', nextNotes);
      }

      return json({ status: 'ok', notes: nextNotes });
    }

    if (url.pathname === '/v1/runtime/notes/reset' && request.method === 'POST') {
      const deleteResult = await deleteRuntimeNotes(env);
      if (!deleteResult.ok) {
        return json({ status: 'error', message: deleteResult.detail }, { status: 503 });
      }

      const resetNotes = (await getRuntimeNotes(env)).notes;
      const schema = await ensureD1Schema(env);
      if (schema.ok) {
        await upsertWorkerState(env, 'runtime_notes', {
          ...resetNotes,
          updated_at: new Date().toISOString(),
          reset: true,
        });
      }

      return json({ status: 'ok', reset: true, notes: resetNotes });
    }

    if (url.pathname === '/v1/runtime/storage' && request.method === 'GET') {
      const snapshot = await getStorageSnapshot(env);
      return json({ status: snapshot.d1.schema.ok ? 'ok' : 'degraded', storage: snapshot });
    }

    if (url.pathname === '/v1/config/summary' && request.method === 'GET') {
      const runtimeConfig = await getRuntimeConfig(env);
      return json({
        status: 'ok',
        source: runtimeConfig.source,
        migrated: runtimeConfig.migrated,
        removed: runtimeConfig.removed,
        summary: getConfigSummary(runtimeConfig.config),
      });
    }

    if (url.pathname === '/v1/metadata' && request.method === 'GET') {
      const metadata = await getOpenAIMetadata(env);
      return json(metadata);
    }

    if (url.pathname === '/config/sections' && request.method === 'GET') {
      const runtimeConfig = await getRuntimeConfig(env);
      return json({
        status: 'ok',
        migrated: runtimeConfig.migrated,
        removed: runtimeConfig.removed,
        sections: Object.fromEntries(
          Object.entries(runtimeConfig.config).map(([section, value]) => [
            section,
            {
              type: Array.isArray(value) ? 'array' : typeof value,
              keys: isPlainObject(value) ? Object.keys(value) : [],
            },
          ])
        ),
      });
    }

    if (url.pathname === '/config' && request.method === 'GET') {
      const runtimeConfig = await getRuntimeConfig(env);
      return json({
        status: 'ok',
        environment: env.APP_ENV || 'unknown',
        source: runtimeConfig.source,
        migrated: runtimeConfig.migrated,
        removed: runtimeConfig.removed,
        config: runtimeConfig.config,
      });
    }

    if (url.pathname.startsWith('/config/') && request.method === 'GET' && url.pathname !== '/config/sections') {
      const section = decodeURIComponent(url.pathname.slice('/config/'.length));
      const runtimeConfig = await getRuntimeConfig(env);
      if (!(section in runtimeConfig.config)) {
        return json({ status: 'error', message: 'section-not-found', section }, { status: 404 });
      }
      return json({
        status: 'ok',
        section,
        value: runtimeConfig.config[section],
        migrated: runtimeConfig.migrated,
        removed: runtimeConfig.removed,
      });
    }

    if (url.pathname === '/config' && request.method === 'POST') {
      let payload;
      try {
        payload = await request.json();
      } catch {
        return json({ status: 'error', message: 'invalid-json' }, { status: 400 });
      }

      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return json({ status: 'error', message: 'payload-must-be-object' }, { status: 400 });
      }

      const currentConfig = await getRuntimeConfig(env);
      const normalized = normalizeConfig(env, deepMerge(currentConfig.config, payload));
      const nextConfig = normalized.config;
      nextConfig.runtime = {
        ...nextConfig.runtime,
        updated_at: new Date().toISOString(),
      };
      const saveResult = await saveRuntimeConfig(env, nextConfig);
      if (!saveResult.ok) {
        return json({ status: 'error', message: saveResult.detail }, { status: 503 });
      }

      const schema = await ensureD1Schema(env);
      if (schema.ok) {
        await upsertWorkerState(env, 'runtime_config', nextConfig);
      }

      return json({
        status: 'ok',
        config: nextConfig,
        migrated: normalized.migrated,
        removed: normalized.removed,
      });
    }

    if (url.pathname === '/config/reset' && request.method === 'POST') {
      const nextConfig = buildDefaultConfig(env);
      nextConfig.runtime = {
        ...nextConfig.runtime,
        updated_at: new Date().toISOString(),
      };

      const saveResult = await saveRuntimeConfig(env, nextConfig);
      if (!saveResult.ok) {
        return json({ status: 'error', message: saveResult.detail }, { status: 503 });
      }

      const schema = await ensureD1Schema(env);
      if (schema.ok) {
        await upsertWorkerState(env, 'runtime_config', nextConfig);
      }

      return json({ status: 'ok', reset: true, config: nextConfig });
    }

    if (url.pathname.startsWith('/config/') && request.method === 'POST') {
      const section = decodeURIComponent(url.pathname.slice('/config/'.length));
      if (!section || section === 'sections') {
        return json({ status: 'error', message: 'invalid-section' }, { status: 400 });
      }

      let payload;
      try {
        payload = await request.json();
      } catch {
        return json({ status: 'error', message: 'invalid-json' }, { status: 400 });
      }

      if (!isPlainObject(payload)) {
        return json({ status: 'error', message: 'payload-must-be-object' }, { status: 400 });
      }

      const currentConfig = await getRuntimeConfig(env);
      if (!(section in currentConfig.config)) {
        return json({ status: 'error', message: 'section-not-found', section }, { status: 404 });
      }

      const normalized = normalizeConfig(env, {
        ...currentConfig.config,
        [section]: deepMerge(currentConfig.config[section], payload),
      });
      const nextConfig = normalized.config;
      nextConfig.runtime = {
        ...nextConfig.runtime,
        updated_at: new Date().toISOString(),
      };

      const saveResult = await saveRuntimeConfig(env, nextConfig);
      if (!saveResult.ok) {
        return json({ status: 'error', message: saveResult.detail }, { status: 503 });
      }

      const schema = await ensureD1Schema(env);
      if (schema.ok) {
        await upsertWorkerState(env, 'runtime_config', nextConfig);
      }

      return json({
        status: 'ok',
        section,
        value: nextConfig[section],
        migrated: normalized.migrated,
        removed: normalized.removed,
      });
    }

    if (url.pathname === '/storage') {
      const snapshot = await getStorageSnapshot(env);
      return json({
        status: snapshot.d1.schema.ok ? 'ok' : 'degraded',
        snapshot,
      }, { status: snapshot.d1.schema.ok ? 200 : 503 });
    }

    return json(
      {
        status: 'deployed',
        message: 'Cloudflare Workers minimal runtime with config and storage is ready.',
        path: url.pathname,
        hint: 'Use /health, /ready, /meta, /config or /storage.',
      },
      { status: 200 }
    );
  },
};
