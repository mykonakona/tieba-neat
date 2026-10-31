"""Create offline layout fixtures without exposing saved account or page content.

Only structural classes, Vue scope markers, layout CSS and an exact list of
generic interface labels survive. No network access or third party packages.
Original snapshots are never modified.
"""
from collections import Counter
from html import escape
from html.parser import HTMLParser
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "snapshots" / "raw"
DEST = ROOT / "snapshots" / "sanitized"
LABELS = set("消息 贴吧APP下载 下载APP 下载App 游戏 游戏中心 游戏推荐 客户端 最有料 相关推荐 猜你喜欢 为你推荐 大家都在看 大家都在搜 关注 发帖 回复 发布 签到 搜索 吧规 吧务团队 个人中心 登录 注册 返回顶部".split())
CLASS = re.compile(r"[A-Za-z_][A-Za-z0-9_-]{0,79}\Z")
DROP = {"script", "noscript", "iframe", "object", "embed", "canvas", "template"}
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
PROPS = re.compile(r"^(?:display|position|inset(?:-.+)?|top|right|bottom|left|(?:min-|max-)?(?:width|height)|margin(?:-.+)?|padding(?:-.+)?|box-sizing|flex(?:-.+)?|grid(?:-.+)?|gap|(?:row|column)-gap|align-.+|justify-.+|order|overflow(?:-.+)?|float|clear|transform(?:-.+)?|z-index|visibility|opacity|font(?:-.+)?|line-height|text-align|white-space|word-break|overflow-wrap|object-fit|aspect-ratio|border(?:-.+)?|color|background-color|--[a-zA-Z0-9_-]+)$")


def declarations(raw):
    kept = []
    for item in raw.split(";"):
        name, sep, value = item.partition(":")
        name, value = name.strip(), value.strip()
        if sep and PROPS.fullmatch(name) and re.fullmatch(r"[a-zA-Z0-9_#.,%()*/+!\s:-]+", value or " "):
            if not re.search(r"url|expression|attr\(|https?|data:|@", value, re.I):
                kept.append(f"{name}:{value}")
    return ";".join(kept)


def stylesheet(raw):
    raw = re.sub(r"/\*.*?\*/", "", raw, flags=re.S)
    # Strip complete url() payloads (including embedded images) before parsing.
    raw = re.sub(r"url\([^)]*\)", "none", raw, flags=re.I)
    raw = re.sub(r"@import[^;]*;", "", raw, flags=re.I)
    result = []
    cursor = 0
    while cursor < len(raw):
        opening = raw.find("{", cursor)
        if opening < 0:
            break
        depth, end = 1, opening + 1
        while end < len(raw) and depth:
            depth += (raw[end] == "{") - (raw[end] == "}")
            end += 1
        selector = raw[cursor:opening].strip()
        body = raw[opening + 1:end - 1]
        cursor = end
        if selector.startswith(("@media", "@supports", "@layer")):
            if re.fullmatch(r"[@a-zA-Z0-9_\s():.,%/-]+", selector):
                result.append(selector + "{" + stylesheet(body) + "}")
        elif not selector.startswith("@") and re.fullmatch(r"[a-zA-Z0-9_\s.#:(),>+~*\[\]=|^$-]+", selector):
            # Only structural selectors; identity-bearing attribute selectors go.
            selector = re.sub(r"\[[^\]]+\]", lambda m: m[0] if re.fullmatch(r"\[data-v-[a-f0-9]+\]", m[0]) else ":not(*)", selector)
            clean = declarations(body)
            if clean:
                result.append(selector + "{" + clean + "}")
    return "\n".join(result)


class Sanitizer(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []
        self.drop_stack = []
        self.style = None
        self.counts = Counter()
        self.icon_ids = {}
        self.kind = "page"

    def icon_id(self, value):
        if value not in self.icon_ids:
            kind = next((k for k in ("message", "game", "download", "app") if k in value.lower()), "other")
            self.icon_ids[value] = f"safe-icon-{len(self.icon_ids)}-{kind}"
        return self.icon_ids[value]

    def handle_starttag(self, tag, attrs):
        if self.drop_stack:
            if tag not in VOID:
                self.drop_stack.append(tag)
            return
        if tag in DROP:
            self.counts["removed_active_elements"] += 1
            if tag not in VOID:
                self.drop_stack.append(tag)
            return
        if tag == "style":
            if dict(attrs).get("id") == "tn-style":
                self.drop_stack.append(tag)
                return
            self.style = []
            return
        if tag in {"meta", "link", "base", "source", "track", "title"}:
            return
        clean = []
        classes = (dict(attrs).get("class") or "").split()
        for cls, kind in (("pb-page-wrapper", "post"), ("home-page-wrapper", "home"), ("frs-page-wrap", "forum"), ("usercenter-page-wrapper", "profile")):
            if cls in classes:
                self.kind = kind
        for name, value in attrs:
            if name == "class":
                classes = [c for c in (value or "").split() if CLASS.fullmatch(c) and not re.search(r"\d{5,}", c)]
                if classes:
                    clean.append((name, " ".join(classes)))
            elif re.fullmatch(r"data-v-[a-f0-9]+", name):
                clean.append((name, ""))
            elif name == "style":
                if "data-tn-wide" not in dict(attrs):
                    clean.append((name, declarations(value or "")))
            elif name in {"width", "height", "colspan", "rowspan"} and re.fullmatch(r"\d{1,4}%?", value or ""):
                clean.append((name, value))
            elif name == "id" and value in {"app", "tn-style"}:
                clean.append((name, value))
            elif name == "id" and tag in {"symbol", "clipPath", "mask"}:
                clean.append((name, self.icon_id(value or "")))
            elif tag == "use" and name in {"href", "xlink:href"} and (value or "").startswith("#"):
                clean.append(("href", "#" + self.icon_id(value[1:])))
            elif name.lower() in {"d", "viewbox", "points", "cx", "cy", "r", "x", "y", "x1", "x2", "y1", "y2"} and re.fullmatch(r"[MmZzLlHhVvCcSsQqTtAa0-9.,\s+-]+", value or ""):
                clean.append((name, value))
            elif name in {"fill", "stroke"} and re.fullmatch(r"(?:none|currentColor|#[a-fA-F0-9]{3,8})", value or ""):
                clean.append((name, value))
            elif name == "type" and tag == "input" and value in {"text", "checkbox", "radio", "button", "submit"}:
                clean.append((name, value))
            else:
                self.counts["removed_attributes"] += 1
        # Images become inert placeholders of the same structural class.
        if tag == "img":
            clean.extend([("alt", ""), ("src", "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==")])
        self.out.append("<" + tag + "".join(f' {k}="{escape(v, quote=True)}"' for k, v in clean) + ">")

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if self.drop_stack:
            if tag in self.drop_stack:
                del self.drop_stack[len(self.drop_stack) - 1 - self.drop_stack[::-1].index(tag):]
            return
        if tag == "style" and self.style is not None:
            self.out.append("<style>" + stylesheet("".join(self.style)) + "</style>")
            self.style = None
        elif tag not in VOID | {"title"}:
            self.out.append(f"</{tag}>")

    def handle_data(self, data):
        if self.drop_stack:
            return
        if self.style is not None:
            self.style.append(data)
        elif data.strip():
            label = data.strip()
            self.out.append(escape(label) if label in LABELS else "[内容已移除]")
            self.counts["removed_text_nodes"] += label not in LABELS


def main():
    # Root-level snapshots remain supported for convenient drag-and-drop input.
    sources = sorted([*RAW.glob("*.html"), *ROOT.glob("*.html")], key=lambda p: (p.name, str(p.parent)))
    if not sources:
        raise SystemExit("No HTML snapshots found. Add local files to snapshots/raw/ first.")
    DEST.mkdir(parents=True, exist_ok=True)
    for index, source in enumerate(sources, 1):
        parser = Sanitizer()
        parser.feed(source.read_text(encoding="utf-8"))
        result = "<!doctype html>\n" + "".join(parser.out)
        # No original URLs, active scripts, form values or event handlers survive.
        assert not re.search(r'https?://|<script\b|\son\w+=|\s(?:value|srcset)=|\shref="(?!#safe-icon-)', result, re.I)
        target = DEST / f"{index:02d}-{parser.kind}.html"
        target.write_text(result, encoding="utf-8")
        print(target.relative_to(ROOT).as_posix(), dict(parser.counts), f"bytes={len(result.encode('utf-8'))}")


if __name__ == "__main__":
    main()
