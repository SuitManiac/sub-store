/**
 * 节点信息(入口版)
 *
 * ⚠️ 本脚本不进行域名解析 如有需要 可在节点操作中添加域名解析
 *

 *
 * 参数
 * - [retries] 重试次数 默认 1
 * - [retry_delay] 重试延时(单位: 毫秒) 默认 1000
 * - [concurrency] 并发数 默认 10
 * - [internal] 使用内部方法获取 IP 信息. 默认 false
 *              支持以下几种运行环境:
 *              1. Surge/Loon(build >= 692) 等有 $utils.ipaso 和 $utils.geoip API 的 App
 *              2. Node.js 版 Sub-Store, 设置环境变量 SUB_STORE_MMDB_COUNTRY_PATH 和 SUB_STORE_MMDB_ASN_PATH, 或 传入 mmdb_country_path 和 mmdb_asn_path 参数(分别为 MaxMind GeoLite2 Country 和 GeoLite2 ASN 数据库 的路径)
 *              数据来自 GeoIP 数据库
 *              ⚠️ 要求节点服务器为 IP. 本脚本不进行域名解析 可在节点操作中添加域名解析
 * - [method] 请求方法. 默认 get
 * - [timeout] 请求超时(单位: 毫秒) 默认 5000
 * - [api] 测入口的 API . 默认为 http://ip-api.com/json/{{proxy.server}}?lang=zh-CN
 * - [format] 自定义格式, 从 节点(proxy) 和 入口(api)中取数据. 默认为: {{api.country}} {{api.isp}} - {{proxy.name}}
 *            当使用 internal 时, 默认为 {{api.countryCode}} {{api.aso}} - {{proxy.name}}
 * - [valid] 验证 api 请求是否合法. 默认: ProxyUtils.isIP('{{api.ip || api.query}}')
 *           当使用 internal 时, 默认为 "{{api.countryCode || api.aso}}".length > 0
 * - [cache] 使用缓存. 默认不使用缓存
 * - [uniq_key] 设置缓存唯一键名包含的节点数据字段名匹配正则. 默认为 ^server$ 即服务器地址相同的节点共享缓存
 * - [ignore_failed_error] 忽略失败缓存. 默认不忽略失败缓存. 若设置为忽略, 之前失败的结果即使有缓存也会再测一次
 * - [entrance] 在节点上附加 _entrance 字段(API 响应数据), 默认不附加
 * - [remove_failed] 移除失败的节点. 默认不移除.
 * - [mmdb_country_path] 见 internal
 * - [mmdb_asn_path] 见 internal
 */

async function operator(proxies = [], targetPlatform, context) {
  const $ = $substore
  const { isNode } = $.env
  const internal = $arguments.internal // 是否使用内部方法
  const mmdb_country_path = $arguments.mmdb_country_path
  const mmdb_asn_path = $arguments.mmdb_asn_path
  
  // 配置项
  const valid = $arguments.valid || `ProxyUtils.isIP('{{api.ip || api.query}}')`
  const format = $arguments.format || `{{api.country}} {{api.isp}} - {{proxy.name}}`
  const ignore_failed_error = $arguments.ignore_failed_error // 是否忽略失败缓存
  const remove_failed = $arguments.remove_failed // 是否移除失败节点
  const entranceEnabled = $arguments.entrance // 是否附加入口数据
  const cacheEnabled = $arguments.cache // 是否启用缓存
  const uniq_key = $arguments.uniq_key || '^server$' // 缓存唯一键
  const method = $arguments.method || 'get' // 请求方法
  const url = $arguments.api || `http://ip-api.com/json/{{proxy.server}}?lang=zh-CN` // API URL
  const concurrency = parseInt($arguments.concurrency || 10) // 并发数

  // 内部方法初始化（根据平台选择使用）
  let utils
  if (internal) {
    if (isNode) {
      utils = new ProxyUtils.MMDB({ country: mmdb_country_path, asn: mmdb_asn_path })
      $.info(`[MMDB] GeoLite2 数据库文件路径: ${mmdb_country_path || process.env.SUB_STORE_MMDB_COUNTRY_PATH}`)
      $.info(`[MMDB] ASN 数据库文件路径: ${mmdb_asn_path || process.env.SUB_STORE_MMDB_ASN_PATH}`)
    } else {
      if (typeof $utils === 'undefined' || typeof $utils.geoip === 'undefined' || typeof $utils.ipaso === 'undefined') {
        $.error('仅支持 Surge/Loon 等平台使用内部方法获取 IP 信息')
        throw new Error('不支持使用内部方法获取 IP 信息')
      }
      utils = $utils
    }
  }

  // 执行代理节点检测
  await executeAsyncTasks(
    proxies.map(proxy => () => check(proxy)),
    { concurrency }
  )

  // 移除失败的代理节点
  if (remove_failed) {
    proxies = proxies.filter(p => p._entrance)
  }

  // 删除入口字段
  if (!entranceEnabled) {
    proxies = proxies.map(p => { delete p._entrance; return p })
  }

  return proxies

  /**
   * 检查每个代理节点
   * @param {Object} proxy - 代理节点对象
   */
  async function check(proxy) {
    const id = cacheEnabled ? generateCacheKey(proxy) : undefined

    try {
      // 尝试从缓存中获取结果
      const cached = cache.get(id)
      if (cacheEnabled && cached) {
        if (cached.api) {
          $.info(`[${proxy.name}] 使用成功缓存`)
          proxy.name = formatResult(proxy, cached.api)
          proxy._entrance = cached.api
          return
        } else if (!ignore_failed_error) {
          $.info(`[${proxy.name}] 使用失败缓存`)
          return
        }
      }

      // 请求API或使用内部方法
      const api = await requestAPI(proxy)
      if (isValid(api)) {
        proxy.name = formatResult(proxy, api)
        proxy._entrance = api
        if (cacheEnabled) cache.set(id, { api }) // 缓存成功结果
      } else {
        if (cacheEnabled) cache.set(id, {}) // 缓存失败结果
      }
    } catch (e) {
      $.error(`[${proxy.name}] 错误: ${e.message || e}`)
      if (cacheEnabled) cache.set(id, {}) // 缓存失败结果
    }
  }

  /**
   * 生成缓存键
   * @param {Object} proxy - 代理节点对象
   * @returns {string} - 缓存键
   */
  function generateCacheKey(proxy) {
    return `entrance:${url}:${format}:${internal}:${JSON.stringify(
      Object.fromEntries(Object.entries(proxy).filter(([key]) => new RegExp(uniq_key).test(key)))
    )}`
  }

  /**
   * 请求代理的API数据
   * @param {Object} proxy - 代理节点对象
   * @returns {Object} - API响应数据
   */
  async function requestAPI(proxy) {
    const startedAt = Date.now()
    let api = {}

    if (internal) {
      // 使用内部方法获取IP和ASN信息
      api = {
        countryCode: utils.geoip(proxy.server) || '',
        aso: utils.ipaso(proxy.server) || ''
      }
      $.info(`[${proxy.name}] CountryCode: ${api.countryCode}, ASN: ${api.aso}`)
    } else {
      // 外部API请求
      const res = await http({
        method,
        url: formatString(url, proxy),
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Mobile/15E148 Safari/604.1'
        }
      })
      api = parseAPIResponse(res)
      $.info(`[${proxy.name}] API响应: ${JSON.stringify(api, null, 2)}, 耗时: ${Date.now() - startedAt}ms`)
    }

    return api
  }

  /**
   * 判断API数据是否有效
   * @param {Object} api - API响应数据
   * @returns {boolean} - 是否有效
   */
  function isValid(api) {
    return eval(formatter({ api, format: valid }))
  }

  /**
   * 格式化API响应数据
   * @param {Object} proxy - 代理节点对象
   * @param {Object} api - API响应数据
   * @returns {string} - 格式化后的节点名称
   */
  function formatResult(proxy, api) {
    return formatter({ proxy, api, format })
  }

  /**
   * 格式化字符串，用代理和API数据替换占位符
   * @param {string} str - 格式化字符串
   * @param {Object} proxy - 代理节点对象
   * @returns {string} - 格式化后的字符串
   */
  function formatString(str, proxy) {
    return eval(`\`${str}\``)
  }

  /**
   * 解析API响应
   * @param {Object} res - HTTP响应对象
   * @returns {Object} - 解析后的API数据
   */
  function parseAPIResponse(res) {
    let api = String(lodash_get(res, 'body'))
    try {
      api = JSON.parse(api)
    } catch (e) {}
    return api
  }

  /**
   * 通用HTTP请求函数
   * @param {Object} opt - 请求选项
   * @returns {Object} - 响应数据
   */
  async function http(opt = {}) {
    const METHOD = opt.method || 'get'
    const TIMEOUT = parseFloat(opt.timeout || $arguments.timeout || 5000)
    const RETRIES = parseFloat(opt.retries ?? $arguments.retries ?? 1)
    const RETRY_DELAY = parseFloat(opt.retry_delay ?? $arguments.retry_delay ?? 1000)

    let count = 0
    const fn = async () => {
      try {
        return await $.http[METHOD]({ ...opt, timeout: TIMEOUT })
      } catch (e) {
        if (count < RETRIES) {
          count++
          const delay = RETRY_DELAY * count
          await $.wait(delay)
          return await fn()
        } else {
          throw e
        }
      }
    }
    return await fn()
  }

  /**
   * 通过路径获取对象值
   * @param {Object} source - 源对象
   * @param {string} path - 属性路径
   * @param {any} defaultValue - 默认值
   * @returns {any} - 属性值
   */
  function lodash_get(source, path, defaultValue = undefined) {
    const paths = path.replace(/\[(\d+)\]/g, '.$1').split('.')
    let result = source
    for (const p of paths) {
      result = Object(result)[p]
      if (result === undefined) {
        return defaultValue
      }
    }
    return result
  }

  /**
   * 字符串格式化函数
   * @param {Object} data - 需要格式化的数据
   * @param {string} format - 格式字符串
   * @returns {string} - 格式化后的字符串
   */
  function formatter({ proxy = {}, api = {}, format
