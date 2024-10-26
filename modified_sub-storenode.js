// 引入$子库
const $=$substore;

// 从$arguments中解构出onlyFlagIP，默认值为true
const {onlyFlagIP = true} = $arguments

// 定义一个异步函数operator，参数为proxies
async function operator(proxies) {
    // 定义每次处理的代理数量
    const BATCH_SIZE = 10;

    // 初始化计数器
    let i = 0;
    // 当计数器小于代理数量时，循环处理
    while (i < proxies.length) {
        // 获取当前批次的代理
        const batch = proxies.slice(i, i + BATCH_SIZE);
        // 并行处理当前批次的代理
        await Promise.all(batch.map(async proxy => {
            // 如果onlyFlagIP为true且代理服务器不是IP地址，则跳过
            if (onlyFlagIP && !ProxyUtils.isIP(proxy.server)) return;
            try {
                // remove the original flag
                let proxyName = removeFlag(proxy.name);

                // query ip-api
                const countryCode = await queryIpApi(proxy);

                proxyName = getFlagEmoji(countryCode) + ' ' + proxyName;
                proxy.name = proxyName;
            } catch (err) {
                // TODO:
            }
        }));

        await sleep(1000);
        i += BATCH_SIZE;
    }
    return proxies;
}



// 修改后的查询函数
async function queryIpApi(proxy) {
    return new Promise((resolve, reject) => {
        // 使用curl命令请求ping0.cc/geo
        const command = `curl -s ping0.cc/geo/${encodeURIComponent(proxy.server)}`;

        // 执行curl命令
        exec(command, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(`exec error: ${error}`));
                return;
            }
            if (stderr) {
                reject(new Error(`stderr: ${stderr}`));
                return;
            }

            try {
                // 解析JSON输出
                const data = JSON.parse(stdout);
                // 假设返回的JSON对象中包含一个country_code字段
                const countryCode = data.country_code;
                resolve(countryCode);
            } catch (parseError) {
                reject(new Error(`Error parsing JSON response: ${parseError}`));
            }
        });
    });
}

// 获取国旗emoji
function getFlagEmoji(countryCode) {
    const codePoints = countryCode
        .toUpperCase()
        .split('')
        .map(char => 127397 + char.charCodeAt());
    return String
        .fromCodePoint(...codePoints)
        .replace(/🇹🇼/g, '🇨🇳');
}

// 移除国旗emoji
function removeFlag(str) {
    return str
        .replace(/[\\uD83C][\\uDDE6-\\uDDFF][\\uD83C][\\uDDE6-\\uDDFF]/g, '')
        .trim();
}

// 暂停函数
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
