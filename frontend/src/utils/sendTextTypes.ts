// The two SendText axes, declared ONCE. Before this file SendMode was spelled out independently in
// five modules with no single source of truth (messageTypes, SendTextDialog, ActionTable,
// deliveryBadge, sendTextStatus); adding a second axis five more times is how a value gets added to
// four of them and forgotten in the fifth.
//
// FLAVOR — what the payload looks like.
export type SendMode = 'rich' | 'markdown' | 'plain' | 'discord';

// METHOD — how it reaches the target. ORTHOGONAL: 'type' is compatible with every flavor except
// 'rich' (typing has no clipboard, so there is no CF_HTML to attach), and markdown / discord are
// the LOSSLESS choice under 'type' because their marks are literal characters.
export type SendMethod = 'paste' | 'type';
