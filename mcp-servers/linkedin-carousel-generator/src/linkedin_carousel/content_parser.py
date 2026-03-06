import re
import yaml
from pathlib import Path
from typing import Dict, List, Optional
from dataclasses import dataclass


@dataclass
class SlideContent:
    slide_num: int
    type: str
    heading: str
    body: str
    max_chars: int


@dataclass
class NewsletterData:
    title: str
    description: str
    slug: str
    sections: List[Dict[str, str]]
    key_takeaways: List[str]
    code_blocks: List[str]
    frontmatter: Dict


class NewsletterParser:
    def __init__(self):
        self.max_chars = {
            "title": 200,
            "takeaway": 250,
            "insight": 400,
            "cta": 150
        }

    def parse_newsletter(self, filepath: Path) -> Optional[NewsletterData]:
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read()

            frontmatter, body = self._split_frontmatter(content)

            if not frontmatter or not body:
                print(f"⚠ Invalid newsletter format: {filepath}")
                return None

            sections = self._extract_sections(body)
            key_takeaways = self._extract_takeaways(body, sections)
            code_blocks = self._extract_code_blocks(body)

            return NewsletterData(
                title=frontmatter.get('title', ''),
                description=frontmatter.get('description', ''),
                slug=frontmatter.get('slug', filepath.stem),
                sections=sections,
                key_takeaways=key_takeaways,
                code_blocks=code_blocks,
                frontmatter=frontmatter
            )

        except Exception as e:
            print(f"Error parsing newsletter: {e}")
            return None

    def _split_frontmatter(self, content: str) -> tuple[Dict, str]:
        if not content.startswith('---'):
            return {}, content

        parts = content.split('---', 2)
        if len(parts) < 3:
            return {}, content

        try:
            frontmatter = yaml.safe_load(parts[1])
            body = parts[2].strip()
            return frontmatter or {}, body
        except:
            return {}, content

    def _extract_sections(self, body: str) -> List[Dict[str, str]]:
        sections = []
        h2_pattern = r'^## (.+)$'

        lines = body.split('\n')
        current_section = None
        current_content = []

        for line in lines:
            h2_match = re.match(h2_pattern, line)
            if h2_match:
                if current_section:
                    sections.append({
                        'heading': current_section,
                        'content': '\n'.join(current_content).strip()
                    })
                current_section = h2_match.group(1)
                current_content = []
            elif current_section:
                current_content.append(line)

        if current_section:
            sections.append({
                'heading': current_section,
                'content': '\n'.join(current_content).strip()
            })

        return sections

    def _extract_takeaways(self, body: str, sections: List[Dict]) -> List[str]:
        takeaways = []

        bullet_pattern = r'^\s*[-*]\s+(.+)$'
        for line in body.split('\n'):
            match = re.match(bullet_pattern, line)
            if match:
                text = match.group(1).strip()
                if 20 < len(text) < 300:
                    takeaways.append(text)

        if not takeaways:
            for section in sections[:3]:
                content = section['content']
                sentences = re.split(r'[.!?]\s+', content)
                for sentence in sentences[:2]:
                    if 20 < len(sentence) < 300:
                        takeaways.append(sentence.strip())

        return takeaways[:6]

    def _extract_code_blocks(self, body: str) -> List[str]:
        code_pattern = r'```[\w]*\n(.*?)```'
        return re.findall(code_pattern, body, re.DOTALL)

    def extract_7_key_points(self, data: NewsletterData) -> List[SlideContent]:
        slides = []

        hook = data.description or (data.sections[0]['content'][:150] + "..." if data.sections else "")
        slides.append(SlideContent(
            slide_num=1,
            type="title",
            heading=data.title,
            body=self._truncate(hook, self.max_chars["title"]),
            max_chars=self.max_chars["title"]
        ))

        takeaways = data.key_takeaways[:3]
        for i, takeaway in enumerate(takeaways, start=2):
            slides.append(SlideContent(
                slide_num=i,
                type="takeaway",
                heading=f"Key Takeaway #{i-1}",
                body=self._truncate(takeaway, self.max_chars["takeaway"]),
                max_chars=self.max_chars["takeaway"]
            ))

        top_sections = self._rank_sections(data.sections)[:2]
        for i, section in enumerate(top_sections, start=5):
            slides.append(SlideContent(
                slide_num=i,
                type="insight",
                heading=section['heading'],
                body=self._truncate(section['content'], self.max_chars["insight"]),
                max_chars=self.max_chars["insight"]
            ))

        cta_text = f"Want more insights like this?\n\nSubscribe to {data.title.split(':')[0].strip()} newsletter"
        slides.append(SlideContent(
            slide_num=7,
            type="cta",
            heading="Join Us!",
            body=self._truncate(cta_text, self.max_chars["cta"]),
            max_chars=self.max_chars["cta"]
        ))

        return slides

    def _rank_sections(self, sections: List[Dict]) -> List[Dict]:
        scored = []
        for section in sections:
            score = 0
            content = section['content'].lower()
            heading = section['heading'].lower()

            if any(kw in heading for kw in ['key', 'important', 'critical', 'essential']):
                score += 5
            if any(kw in content for kw in ['because', 'therefore', 'this means', 'result']):
                score += 3
            if len(content) > 200:
                score += 2

            scored.append((score, section))

        scored.sort(key=lambda x: x[0], reverse=True)
        return [s[1] for s in scored]

    def _truncate(self, text: str, max_length: int) -> str:
        text = re.sub(r'\s+', ' ', text).strip()

        if len(text) <= max_length:
            return text

        truncated = text[:max_length].rsplit(' ', 1)[0]
        return truncated + "..."
