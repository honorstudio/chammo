// 팀 홈 글·고정 공지 — Rust team_post(팀 보관함 봉투 길 kind post, 서버엔 평문 없음). teamApi.ts 와 따로 둔 건 다른 가지가 그 파일을 고치는 중이라
import { invoke } from '@tauri-apps/api/core';
import type { PostBoard } from '../domain/teamPosts';

export const teamPosts = (team: string) => invoke<PostBoard>('team_posts', { team });
/** origin = 고칠 글 id — 글 id 를 돌려준다 */
export const teamPostWrite = (team: string, title: string, body: string, origin?: string) => invoke<string>('team_post_write', { team, title, body, origin: origin ?? null });
/** post 빈 글 = 고정 풀기(팀장만) */
export const teamPostPin = (team: string, post: string) => invoke<void>('team_post_pin', { team, post });
export const teamPostRemove = (team: string, post: string) => invoke<void>('team_post_remove', { team, post });
