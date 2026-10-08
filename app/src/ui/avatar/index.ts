// 참모 프사 내보내기 — 앱 화면·모바일(나중) 모두 여기서 가져간다. 규칙은 domain/avatar, 저장은 Rust avatar.rs
export { OrchAvatar, cropTransform } from './OrchAvatar';
export { BrandMark } from './BrandMark';
export { useAvatars, saveAvatar, resetAvatar, imageUrl, setAvatarSource, avatarSnapshot, setAvatarTts, refreshAvatars } from './store';
export { avatarKey, avatarState, bodyColor, orchColor, ORCH_COLORS, type Avatar, type AvatarState } from '../../domain/avatar';
