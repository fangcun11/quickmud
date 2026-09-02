/**
 * A3 输出渲染器测试
 */
import { describe, it, expect } from 'vitest';
import { OutputCollector, s, seg } from './output/output-collector';
import { renderAnsi, renderSemanticHtml, renderPlainText } from './output/render';

function sampleMessages() {
  const c = new OutputCollector();
  c.title('酒馆');
  c.narrative([
    s('你走进了'),
    seg('酒保', { color: 'blue', tag: 'entity', entityRef: 'npc-001' }),
    s('身边，'),
    seg('麦酒的香气', { italic: true }),
    s('扑面而来。'),
  ]);
  c.dialogue([s('"客官，来一杯？"')]);
  c.error('那里没有路。');
  c.system([s('你恢复了 10 点生命。')]);
  return c.getAll();
}

describe('A3 输出渲染器', () => {
  it('renderAnsi：kind 默认色 + segment 样式覆盖 + 转义序列正确', () => {
    const out = renderAnsi(sampleMessages());
    expect(out).toContain('\x1b[36m\x1b[1m酒馆\x1b[0m'); // title: cyan+bold
    expect(out).toContain('\x1b[31m那里没有路。\x1b[0m'); // error: red
    expect(out).toContain('\x1b[34m酒保\x1b[0m'); // entity: 蓝色覆盖
    expect(out).toContain('\x1b[3m麦酒的香气\x1b[0m'); // italic
    // 无样式 narrative 不带转义
    expect(out).toContain('扑面而来。');
  });

  it('renderAnsi：noColor 关闭所有转义序列', () => {
    const out = renderAnsi(sampleMessages(), { noColor: true });
    expect(out).not.toContain('\x1b[');
    expect(out).toContain('酒保');
  });

  it('renderAnsi：同一消息序列输出恒等（确定性）', () => {
    expect(renderAnsi(sampleMessages())).toBe(renderAnsi(sampleMessages()));
  });

  it('renderSemanticHtml：结构、data-* 属性、HTML 转义', () => {
    const c = new OutputCollector();
    c.error('小心 <script>alert("x")</script> 陷阱');
    const html = renderSemanticHtml(c.getAll());
    expect(html).toBe(
      '<p class="mud-error"><span>小心 &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; 陷阱</span></p>',
    );

    const html2 = renderSemanticHtml(sampleMessages());
    // kind 的默认颜色语义在 HTML 端由 class 承担；data-* 只表达 segment 级覆盖
    expect(html2).toContain('<p class="mud-title"><span>酒馆</span></p>');
    expect(html2).toContain('data-tag="entity"');
    expect(html2).toContain('data-entity-ref="npc-001"');
    expect(html2).toContain('data-italic');
  });

  it('renderPlainText：纯文本丢弃样式', () => {
    const out = renderPlainText(sampleMessages());
    expect(out).not.toContain('\x1b[');
    expect(out).not.toContain('<');
    expect(out.split('\n')).toHaveLength(sampleMessages().length);
  });
});
