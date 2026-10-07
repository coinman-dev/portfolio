import React from 'react';
import { ExternalLink } from '../ui/icons';
import { openExternal } from '../../openExternal';

/**
 * Minimal CommonMark subset used by yearn.fi vault descriptions.
 * Raw HTML is skipped (the site renders markdown with `skipHtml`), and only
 * links, bold, italic and strikethrough are supported.
 */

const INLINE_PATTERN = /\[([^\]]+)\]\(([^)\s]+)\)|(\*\*|__)(.+?)\3|(~~)(.+?)\5|(\*|_)(.+?)\7/;

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let rest = text;
  let index = 0;

  while (rest.length > 0) {
    const match = INLINE_PATTERN.exec(rest);
    if (!match || match.index === undefined) {
      nodes.push(rest);
      break;
    }

    if (match.index > 0) nodes.push(rest.slice(0, match.index));
    const key = `${keyPrefix}-${index++}`;

    if (match[1] !== undefined) {
      const href = match[2];
      nodes.push(
        <button
          key={key}
          type="button"
          className="y-about__link"
          onClick={(event) => {
            event.stopPropagation();
            openExternal(href);
          }}
        >
          {match[1]}
          <ExternalLink size={12} />
        </button>,
      );
    } else if (match[4] !== undefined) {
      nodes.push(<b key={key}>{renderInline(match[4], key)}</b>);
    } else if (match[6] !== undefined) {
      nodes.push(<del key={key}>{renderInline(match[6], key)}</del>);
    } else if (match[8] !== undefined) {
      nodes.push(<i key={key}>{renderInline(match[8], key)}</i>);
    }

    rest = rest.slice(match.index + match[0].length);
  }

  return nodes;
}

interface MarkdownProps {
  content: string;
  className?: string;
}

export const Markdown: React.FC<MarkdownProps> = ({ content, className }) => {
  const paragraphs = content
    .replace(/<[^>]*>/g, '')
    .split(/\n{2,}/)
    .map((block) => block.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  if (paragraphs.length === 0) return null;

  return (
    <div className={className}>
      {paragraphs.map((paragraph, i) => (
        <p key={`p-${i}`}>{renderInline(paragraph, `p${i}`)}</p>
      ))}
    </div>
  );
};
