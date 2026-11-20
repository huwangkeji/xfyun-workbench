// Mock 上游大模型 SSE 服务（端口 3003）
// 端点：POST /v2/chat/completions（讯飞风格 baseUrl 直连）
// 行为：先流式输出 6 段 reasoning_content（每段 300ms），再流式输出 5 段 content（每段 250ms），最后 usage chunk + [DONE]
const http = require('http');

function chunk(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

const server = http.createServer((req, res) => {
  if (!req.url.includes('/v2/chat/completions')) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  let lastLen = 0;
  req.on('data', () => {}); // 消费请求体
  req.on('end', () => {
    const thinks = ['收到问题，先分析意图。', '判断这是知识库相关的咨询。', '梳理回答框架。', '核对术语表述。', '组织语言分点输出。', '准备生成最终回答。'];
    const answers = ['你好！', '这是星火工作台的', '流式思考演示：', '思考过程会实时滚动展示，', '完成后自动折叠为「已完成思考」。'];
    let i = 0;
    const thinkTimer = setInterval(() => {
      chunk(res, { choices: [{ delta: { reasoning_content: thinks[i] } }] });
      i++;
      if (i >= thinks.length) {
        clearInterval(thinkTimer);
        let j = 0;
        const ansTimer = setInterval(() => {
          chunk(res, { choices: [{ delta: { content: answers[j] } }] });
          j++;
          if (j >= answers.length) {
            clearInterval(ansTimer);
            chunk(res, { choices: [{ delta: {} }], usage: { prompt_tokens: 120, completion_tokens: 88, total_tokens: 208 } });
            res.write('data: [DONE]\n\n');
            res.end();
          }
        }, 250);
      }
    }, 300);
  });
  void lastLen;
});

server.listen(3003, '127.0.0.1', () => console.log('mock upstream on 3003'));
