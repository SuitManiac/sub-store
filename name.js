const $ = require('substore'); // 假设substore是一个模块，需要导入

const { onlyFlagIP = true } = process.argv; // 从命令行参数获取配置

async function operator(proxies) {
    const BATCH_SIZE = 10;

    let i = 0;
    while (i < proxies.length) {
        const batch = proxies.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async proxy => {
            if (onlyFlagIP && !ProxyUtils.isIP(proxy.server)) return;
            try {
                // 获取国旗表情符号
                const countryCode = await queryIpApi(proxy);
                const flagEmoji = getFlagEmoji(countryCode);
                // 修改代理服务器名称
                proxy.name = `${flagEmoji} ${proxy.name}`;
            } catch (err) {
                console.error(`Error processing proxy ${proxy.server}: ${err.message}`);
            }
        }));

        await sleep(1000);
        i += BATCH_SIZE;
    }
    return proxies;
}

async function queryIpApi(proxy) {
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.10; rv:78.0) Gecko/20100101 Firefox/78.0";
    const headers = {
        "User-Agent": ua
    };
    try {
        const response = await $.http.get({
            url: `http://ip-api.com/json/${encodeURIComponent(proxy.server)}?lang=zh-CN`,
            headers,
        });
        const data = JSON.parse(response.body);
        if (data.status === "success") {
            return data.countryCode;
        } else {
            throw new Error(data.message);
        }
    } catch (err) {
        console.error(`Error querying IP API for ${proxy.server}: ${err.message}`);
        throw err; // Re-throw the error to handle it in the calling function
    }
}

function getFlagEmoji(countryCode) {
    const codePoints = countryCode
        .toUpperCase()
        .split('')
        .map(char => 127397 + char.charCodeAt(0));
    return String
        .fromCodePoint(...codePoints)
        .replace(/🇹🇼/g, '🇨🇳'); // Replace Taiwan flag with China flag
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Example usage:
const proxies = [
    { server: '192.168.1.1', name: 'Local Proxy' },
    { server: '8.8.8.8', name: 'Google DNS' },
    // Add more proxies as needed
];

operator(proxies).then(updatedProxies => {
    console.log(updatedProxies);
}).catch(err => {
    console.error('Failed to update proxy names:', err);
});