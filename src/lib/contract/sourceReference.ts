/** UTF-16 offsets into the immutable plaintext snapshot, not editor document positions. */
export interface SourceReference { snapshotId: string; pageId: string; rev: string; start: number; end: number }
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function validSourceReference(value: unknown): value is SourceReference {
 if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
 const ref = value as Record<string, unknown>;
 return Object.keys(ref).length === 5 && ['snapshotId', 'pageId', 'rev', 'start', 'end'].every(key => key in ref)
  && hash(ref.snapshotId) && hash(ref.rev) && typeof ref.pageId === 'string' && ref.pageId.length > 0 && ref.pageId.length <= 200
  && Number.isSafeInteger(ref.start) && Number.isSafeInteger(ref.end) && (ref.start as number) >= 0 && (ref.end as number) > (ref.start as number);
}
export function sourceContains(outer: SourceReference, inner: SourceReference): boolean {
 return outer.snapshotId === inner.snapshotId && outer.pageId === inner.pageId && outer.rev === inner.rev
  && outer.start <= inner.start && inner.end <= outer.end;
}
export function validCitationReferences(citation: Record<string, unknown>, required: boolean): boolean {
 const source = citation.source_ref, focus = citation.focus_source_ref;
 if (source === undefined) return !required && focus === undefined;
 if (!validSourceReference(source) || source.pageId !== citation.page_id || typeof citation.quoted_text !== 'string'
  || source.end - source.start !== citation.quoted_text.length) return false;
 if (citation.focus_text !== undefined && typeof citation.focus_text !== 'string') return false;
 if (focus === undefined) return !citation.focus_text;
 return validSourceReference(focus) && sourceContains(source, focus) && typeof citation.focus_text === 'string'
  && citation.focus_text.length > 0 && focus.end - focus.start === citation.focus_text.length
  && citation.quoted_text.slice(focus.start - source.start, focus.end - source.start) === citation.focus_text;
}
export function exactSourceSlice(ref: SourceReference, quote: string, snapshotId: string, page: { pageId: string; rev: string; text: string }): boolean {
 return ref.snapshotId === snapshotId && ref.pageId === page.pageId && ref.rev === page.rev && ref.end <= page.text.length
  && !/[\uDC00-\uDFFF]/u.test(page.text[ref.start] ?? '') && !/[\uDC00-\uDFFF]/u.test(page.text[ref.end] ?? '')
  && page.text.slice(ref.start, ref.end) === quote;
}
