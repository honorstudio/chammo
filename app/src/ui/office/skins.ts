// 픽셀 사무실 스킨 = 색 묶음 하나. 배치(domain/office)와 따로 둬서 스킨만 갈아 끼운다.
// 시안 docs/design-drafts/pixel-office — 기본은 A 아늑한 방(나무)

import { tr } from '../../i18n';

export type Skin = {
  bg: string; floor: [string, string]; grain: string; wallL: string; wallR: string; wallTop: string;
  deskTop: string; deskL: string; deskR: string; mon: string; monR: string; screen: string;
  on: [string, string, string]; line: string; pets: string[]; pat: string;
  leaf: [string, string]; pot: string; sky: string; frame: string; shelf: string; books: string[]; cooler: string; water: string;
  paper: string; label: 'light' | 'dark' | 'lcd'; stars?: boolean; planks?: boolean;
  /** 반장 명패 윗면·앞·옆 (기본 금색) */
  plate?: [string, string, string];
  /** 방 안에 날리는 것 */
  weather?: 'snow' | 'petal' | 'bubble' | 'ember' | 'leaf' | 'rain' | 'star' | 'confetti';
};

export const SKINS: Record<string, Skin> = {
  wood: {
    bg: '#efe6d8', floor: ['#c99e70', '#c1945f'], grain: '#a97c4e', wallL: '#e8d9c0', wallR: '#f3e8d4', wallTop: '#7d5b3d',
    deskTop: '#8d5d3d', deskL: '#6f4531', deskR: '#5a3727', mon: '#2e2a30', monR: '#3b3742', screen: '#1c2838',
    on: ['#7fd1ff', '#ffd27a', '#9ef0a4'], line: '#2a1c14', pets: ['#ffd9a8', '#bfe3ff', '#c9f0c1', '#ffc6d9', '#e6d4ff', '#fff1a6', '#ffcfb0', '#d0f2ee'],
    pat: '#e0a36b', leaf: ['#4d9a57', '#35743f'], pot: '#b8663f', sky: '#bfe5ff', frame: '#8a6a4a', shelf: '#8d5d3d',
    books: ['#d9786b', '#6ea6d9', '#e0b94f', '#7cc48a'], cooler: '#f4f4f4', water: '#8fd0ff', paper: '#ffffff', label: 'light', planks: true,
  },
  mint: {
    bg: '#eaf3ef', floor: ['#dde8e3', '#d3e0da'], grain: '#c6d5ce', wallL: '#f4f7f6', wallR: '#ffffff', wallTop: '#9fb3ab',
    deskTop: '#fbfbfb', deskL: '#d2dcd8', deskR: '#bccac4', mon: '#3a4148', monR: '#4a525a', screen: '#223040',
    on: ['#6fe0c6', '#ffcf6a', '#8fd0ff'], line: '#24302b', pets: ['#ffd6c2', '#c8e6ff', '#d4f5c9', '#ffd0e4', '#e7dbff', '#fff3b3', '#c9f1ea', '#ffe0b8'],
    pat: '#9cc7b8', leaf: ['#3fa36b', '#2c7d52'], pot: '#e8e2d6', sky: '#cdeeff', frame: '#b8c7c1', shelf: '#e9eeec',
    books: ['#6fb7a2', '#8fb2e8', '#f0c77a', '#ee9fb3'], cooler: '#ffffff', water: '#9ad8ff', paper: '#ffffff', label: 'light',
  },
  lcd: {
    bg: '#b7c492', floor: ['#aebb88', '#a6b37f'], grain: '#98a571', wallL: '#a2af7b', wallR: '#aab784', wallTop: '#2c3a1c',
    deskTop: '#8f9c69', deskL: '#7c895a', deskR: '#6e7b4e', mon: '#2c3a1c', monR: '#3a4827', screen: '#5f6c42',
    on: ['#1f2a14', '#1f2a14', '#1f2a14'], line: '#1f2a14', pets: ['#b7c492'], pat: '#7c895a',
    leaf: ['#4d5a33', '#3a4827'], pot: '#6e7b4e', sky: '#c4d0a0', frame: '#2c3a1c', shelf: '#7c895a',
    books: ['#3a4827', '#5f6c42'], cooler: '#c4d0a0', water: '#8f9c69', paper: '#d2dcb0', label: 'lcd', plate: ['#3a4827', '#2c3a1c', '#1f2a14'],
  },
  neon: {
    bg: '#0d0e1c', floor: ['#1a1c33', '#1e2140'], grain: '#262a50', wallL: '#1f2247', wallR: '#262a57', wallTop: '#ff4fd8',
    deskTop: '#3b3163', deskL: '#2c254c', deskR: '#221d3c', mon: '#101226', monR: '#171a33', screen: '#0b1a26',
    on: ['#39f3ff', '#ff4fd8', '#b6ff5c'], line: '#07070f', pets: ['#ffb3f0', '#9ff8ff', '#d6ff9e', '#ffd19e', '#c9b3ff', '#fff59e', '#9effd1', '#ffb3b3'],
    pat: '#7a5cff', leaf: ['#1fbf8f', '#128a66'], pot: '#3b3163', sky: '#101a44', frame: '#39f3ff', shelf: '#2c254c',
    books: ['#ff4fd8', '#39f3ff', '#b6ff5c', '#ffcf4f'], cooler: '#2c254c', water: '#39f3ff', paper: '#e8e8ff', label: 'dark', stars: true,
  },
  camp: {
    bg: '#dcebd2', floor: ['#8fbf6a', '#86b562'], grain: '#6f9e4f', wallL: '#c9a77c', wallR: '#d6b68a', wallTop: '#6b4a2e',
    deskTop: '#b8844f', deskL: '#976a3c', deskR: '#7d5630', mon: '#2e2a30', monR: '#3b3742', screen: '#1c2838',
    on: ['#ffd27a', '#ff8a3d', '#9ef0a4'], line: '#2a1c14', pets: ['#ffe0b8', '#d4f5c9', '#fff1a6', '#ffcfb0', '#e6d4ff', '#bfe3ff'],
    pat: '#c9a77c', leaf: ['#3f8f4f', '#2c6e3c'], pot: '#8d5d3d', sky: '#ffd9a8', frame: '#6b4a2e', shelf: '#976a3c',
    books: ['#e5484d', '#ffc93c', '#5aa0e6', '#7cc48a'], cooler: '#e8743a', water: '#ffd27a', paper: '#fff6e6', label: 'light', planks: true,
  },
  library: {
    bg: '#e9e2d4', floor: ['#6e4a33', '#664530'], grain: '#553a28', wallL: '#3f5a45', wallR: '#48664f', wallTop: '#2a1c14',
    deskTop: '#5a3727', deskL: '#452a1d', deskR: '#382218', mon: '#2e2a30', monR: '#3b3742', screen: '#1c2838',
    on: ['#ffd27a', '#e0b94f', '#9ef0a4'], line: '#1a120c', pets: ['#ffd9a8', '#e6d4ff', '#c9f0c1', '#ffc6d9', '#fff1a6', '#bfe3ff'],
    pat: '#b8663f', leaf: ['#4d9a57', '#35743f'], pot: '#8d5d3d', sky: '#f3e2b8', frame: '#2a1c14', shelf: '#452a1d',
    books: ['#8b2f2f', '#2f4f8b', '#2f6b3f', '#8b6b2f', '#5a2f6b'], cooler: '#e8dcc2', water: '#bfe5ff', paper: '#f6efe0', label: 'light', planks: true,
  },
  ocean: {
    bg: '#0f3b4f', floor: ['#e8d7a8', '#e0cd9b'], grain: '#cdb682', wallL: '#1f6f8b', wallR: '#2a86a6', wallTop: '#9ff8ff',
    deskTop: '#f28c6b', deskL: '#d9704f', deskR: '#bb5b3d', mon: '#12303d', monR: '#1a4252', screen: '#0b2530',
    on: ['#9ff8ff', '#ffd27a', '#b6ff5c'], line: '#0b2530', pets: ['#ffb3c8', '#9ff8ff', '#fff1a6', '#c9f0c1', '#ffcfb0', '#e6d4ff'],
    pat: '#f28c6b', leaf: ['#2fbf8f', '#1f8a66'], pot: '#e8d7a8', sky: '#5fc8e8', frame: '#e8d7a8', shelf: '#1a4252',
    books: ['#ff8a8a', '#ffd27a', '#9ff8ff', '#b6ff5c'], cooler: '#e8d7a8', water: '#5fc8e8', paper: '#f6fbff', label: 'dark', stars: true, weather: 'bubble',
  },
  space: {
    bg: '#07081a', floor: ['#2c3148', '#262a3f'], grain: '#3a4060', wallL: '#3b4260', wallR: '#454d70', wallTop: '#9aa6d6',
    deskTop: '#c9cfe0', deskL: '#9aa2bb', deskR: '#7c849d', mon: '#101226', monR: '#171a33', screen: '#0b1a26',
    on: ['#39f3ff', '#ffcf4f', '#b6ff5c'], line: '#07070f', pets: ['#c9b3ff', '#9ff8ff', '#ffb3f0', '#fff59e', '#9effd1', '#ffd19e'],
    pat: '#7a8ad6', leaf: ['#5fd6a0', '#3aa97a'], pot: '#454d70', sky: '#050616', frame: '#9aa6d6', shelf: '#3b4260',
    books: ['#39f3ff', '#ff4fd8', '#ffcf4f', '#b6ff5c'], cooler: '#c9cfe0', water: '#39f3ff', paper: '#e8ecff', label: 'dark', stars: true, weather: 'star',
  },
  // ───── 2026-09-27 추가 18종 (사용자: "스킨 많이많이") ─────
  cafe: sk('#f3e6d6', ['#a9795a', '#a07152'], '#8a5f43', '#e9d3b5', '#f2e0c6', '#5a3727', '#6b4a3a', '#56392b', '#46301f', 'light', { sky: '#cfe8ff', books: ['#c96a5e', '#e0b94f', '#7cc48a'], planks: true }),
  classroom: sk('#eef0e4', ['#c9b48d', '#c1ab83'], '#a88f68', '#dfe8d8', '#e9f0e2', '#3f6b4f', '#caa56f', '#a98552', '#8d6d41', 'light', { sky: '#bfe5ff', planks: true }),
  greenhouse: sk('#e4f2df', ['#b7d3a0', '#aecb97'], '#93b37c', '#d9eed3', '#e8f6e4', '#5f8f55', '#e8e2d6', '#cbc4b6', '#b3ab9c', 'light', { sky: '#e8fbff', leaf: ['#3fa36b', '#2c7d52'] }),
  mono: sk('#e9e9e9', ['#cfcfcf', '#c6c6c6'], '#b0b0b0', '#dedede', '#ececec', '#3a3a3a', '#5a5a5a', '#474747', '#383838', 'light', { pets: ['#ffffff', '#e6e6e6', '#d0d0d0'], books: ['#3a3a3a', '#6a6a6a', '#9a9a9a'], sky: '#f4f4f4', leaf: ['#6a6a6a', '#4a4a4a'], pot: '#5a5a5a', on: ['#ffffff', '#cfcfcf', '#ffffff'] }),
  sakura: sk('#fdecf1', ['#f3cfd8', '#efc5cf'], '#e3b0bd', '#fbe3ea', '#fff0f4', '#c96a86', '#e9b3c2', '#d99bad', '#c78699', 'light', { sky: '#ffe3ec', leaf: ['#f49ab8', '#e07a9c'], weather: 'petal' }),
  beach: sk('#e6f6fb', ['#f1dfb2', '#ead6a5'], '#d9c48f', '#bfe8f4', '#d4f1f9', '#2a86a6', '#f2a65a', '#d98e45', '#bb7738', 'light', { sky: '#7fd4f0', leaf: ['#2fbf8f', '#1f8a66'], pot: '#e8d7a8' }),
  cabin: sk('#e7eef5', ['#8a6446', '#835e41'], '#6b4a33', '#a9784f', '#b8875c', '#4a3020', '#6e4a31', '#5a3c28', '#48301f', 'light', { sky: '#dfe9f5', planks: true, weather: 'snow' }),
  forest: sk('#e1efd9', ['#7fae5e', '#77a657'], '#5f8f45', '#9a7a55', '#a8865e', '#3f5a2e', '#8d6a45', '#735638', '#5e452d', 'light', { sky: '#cdeeb8', leaf: ['#2f7d3f', '#1f5e2e'], weather: 'leaf' }),
  candy: sk('#fff0f7', ['#ffd6e8', '#ffcce2'], '#ffb3d4', '#e6d4ff', '#f3e8ff', '#e07ab8', '#9ff0e0', '#7fd9c7', '#63c0ad', 'light', { sky: '#fff6b3', pets: ['#ffffff', '#fff1a6', '#c9f0c1', '#bfe3ff'], books: ['#ff8ac2', '#9ff0e0', '#fff1a6', '#c9b3ff'], weather: 'confetti' }),
  hanok: sk('#f2ece0', ['#c9a27a', '#c19a72'], '#a6835e', '#efe6d4', '#f7f0e2', '#3b2a1e', '#6b4a33', '#573b28', '#46301f', 'light', { sky: '#e8f0f6', frame: '#3b2a1e', planks: true, leaf: ['#5f8f55', '#3f6b3a'] }),
  gameboy: sk('#9bbc0f', ['#8bac0f', '#86a70e'], '#6f8f0c', '#7fa00e', '#8bac0f', '#0f380f', '#306230', '#244d24', '#1a3a1a', 'lcd', { pets: ['#9bbc0f'], books: ['#0f380f', '#306230'], sky: '#9bbc0f', frame: '#0f380f', paper: '#9bbc0f', leaf: ['#306230', '#0f380f'], pot: '#306230', on: ['#0f380f', '#0f380f', '#0f380f'], plate: ['#306230', '#0f380f', '#0f380f'] }),
  cyber: sk('#0a0614', ['#161028', '#1b1432'], '#2a1f4a', '#1a1030', '#221640', '#ff2bd6', '#2a1f4a', '#1f173a', '#17112c', 'dark', { sky: '#12082a', on: ['#00f0ff', '#ff2bd6', '#f5ff3b'], books: ['#00f0ff', '#ff2bd6', '#f5ff3b'], frame: '#00f0ff', stars: true, weather: 'rain' }),
  halloween: sk('#1c1426', ['#3a2a3f', '#33253a'], '#4a3650', '#2b1f35', '#34263f', '#ff8a1f', '#4a2a1a', '#3a2014', '#2c180f', 'dark', { sky: '#2a1a3f', pets: ['#ffb36b', '#c9b3ff', '#b6ff5c'], books: ['#ff8a1f', '#8a4fff', '#b6ff5c'], leaf: ['#ff8a1f', '#c95f10'], pot: '#4a2a1a', weather: 'leaf' }),
  christmas: sk('#f6efe6', ['#c94a4a', '#bf4242'], '#a53636', '#2f6b3f', '#377a48', '#e0b94f', '#8a5a3a', '#744a30', '#603d27', 'light', { sky: '#1f2f55', stars: true, leaf: ['#2f7d3f', '#1f5e2e'], books: ['#e5484d', '#e0b94f', '#2f7d3f'], weather: 'snow' }),
  desert: sk('#f7ead2', ['#e6c48a', '#dfbb80'], '#c9a46a', '#e9c99a', '#f1d6ab', '#a8663a', '#c98a55', '#ad7445', '#936038', 'light', { sky: '#ffd99a', leaf: ['#6f9a4f', '#557a3c'], pot: '#c98a55' }),
  dungeon: sk('#15131a', ['#3a3640', '#34303a'], '#4a4550', '#2a2730', '#322e38', '#e0b94f', '#5a3f2a', '#4a3322', '#3a281a', 'dark', { sky: '#0e0c14', on: ['#ffb33b', '#ff6b3b', '#ffe07a'], books: ['#8a2f2f', '#2f4f8a', '#8a7a2f'], weather: 'ember' }),
  volcano: sk('#1a0d0a', ['#3a1d14', '#43221a'], '#5a2a1c', '#2a1410', '#351a14', '#ff5a1f', '#4a2418', '#3a1c12', '#2c150e', 'dark', { sky: '#5a1a0a', on: ['#ff8a3d', '#ffcf4f', '#ff5a1f'], books: ['#ff5a1f', '#ffcf4f', '#8a2f1f'], leaf: ['#5a3a2a', '#3a2418'], weather: 'ember' }),
  matcha: sk('#eef3e2', ['#b8c98f', '#afc186'], '#98ac72', '#dfe8c8', '#e9f0d6', '#5a7a3a', '#e9dcc0', '#d3c4a3', '#bba98a', 'light', { sky: '#e8f6d8', leaf: ['#5f8f3f', '#3f6b2a'] }),
  choco: sk('#f0e2d6', ['#7a4a33', '#71432e'], '#5c3625', '#a86e4f', '#b67c5c', '#3a2014', '#e8c8a8', '#d0ad8a', '#b8946f', 'light', { sky: '#ffe8d0', pets: ['#ffe0c2', '#fff1a6', '#ffc6d9'], books: ['#7a4a33', '#e8c8a8', '#ff8ac2'], planks: true }),
  strawberry: sk('#fff0f0', ['#ffc9cf', '#ffc0c7'], '#f5a9b2', '#fff6f6', '#ffffff', '#e5484d', '#ff8a8a', '#e57070', '#cc5c5c', 'light', { sky: '#ffe3e3', leaf: ['#5fbf6a', '#3f9a4a'], pot: '#ffffff', books: ['#e5484d', '#ffffff', '#5fbf6a'] }),
  pastel: sk('#f6f0ff', ['#e2f0ff', '#dcebff'], '#c9dcf5', '#ffe8f2', '#fff3f8', '#b8a6e6', '#fff6c9', '#f0e6b0', '#dcd198', 'light', { sky: '#e3f6ff', pets: ['#ffd6e8', '#d6f0ff', '#e8ffd6', '#fff3c9'], books: ['#ffb8d9', '#b8e2ff', '#c9ffb8', '#fff0a6'] }),
  autumn: sk('#f7ebdc', ['#c98a4a', '#c18244'], '#a86e36', '#f0d8b8', '#f6e2c6', '#8a3f1f', '#8d5d3d', '#6f4531', '#5a3727', 'light', { sky: '#ffd9a8', leaf: ['#d9602f', '#b84a1f'], weather: 'leaf', planks: true }),
  jungle: sk('#e1f0d6', ['#5f8f3f', '#58873a'], '#467330', '#3f6b3a', '#4a7a43', '#2a4a22', '#8d6a45', '#735638', '#5e452d', 'light', { sky: '#b8e89a', leaf: ['#2f9a4f', '#1f7a3a'], books: ['#e5484d', '#ffc93c', '#7cc48a'], weather: 'leaf' }),
  retro: sk('#1a1030', ['#2a1848', '#321d55'], '#ff4fd8', '#3a1f5a', '#452566', '#39f3ff', '#ff8a3d', '#e56f28', '#c45a1a', 'dark', { sky: '#ff6b9a', on: ['#39f3ff', '#ff4fd8', '#ffd27a'], books: ['#ff4fd8', '#39f3ff', '#ffd27a'], frame: '#39f3ff' }),
  lighthouse: sk('#e8f2f8', ['#d6e6ee', '#cddfe8'], '#b8cdd9', '#ffffff', '#f4f8fb', '#e5484d', '#e5484d', '#c23a3f', '#a02f33', 'light', { sky: '#7fc8ec', books: ['#e5484d', '#1f4f7a', '#ffffff'], leaf: ['#3f8f6a', '#2c6e4f'] }),
  rainycity: sk('#1c2230', ['#3a4455', '#343d4d'], '#4a5568', '#2a3242', '#323b4d', '#8fb2e8', '#4a4f5a', '#3a3f4a', '#2e333d', 'dark', { sky: '#3a4a66', on: ['#8fd0ff', '#ffd27a', '#9ef0a4'], weather: 'rain' }),
  pirate: sk('#1f2a33', ['#7a5436', '#704d31'], '#5c3f28', '#5a3a24', '#65422a', '#e0b94f', '#3a2418', '#2e1c12', '#24160e', 'dark', { sky: '#2a4a66', books: ['#e5484d', '#e0b94f', '#1f1f1f'], leaf: ['#3f6b3a', '#2a4f28'], planks: true, stars: true }),
  sakuranight: sk('#140f24', ['#2a2140', '#302548'], '#3a2d55', '#221a3a', '#2a2046', '#f49ab8', '#3a2a4f', '#2e2140', '#241a33', 'dark', { sky: '#1a1440', pets: ['#ffd0e4', '#e6d4ff', '#fff1a6'], leaf: ['#f49ab8', '#d97aa0'], stars: true, weather: 'petal' }),
  aurora: sk('#0b1433', ['#dfe9f5', '#d6e2f0'], '#c2d2e6', '#1a2a55', '#223366', '#7cf0b0', '#c9d6e8', '#aebdd4', '#95a6c0', 'dark', { sky: '#0b1433', on: ['#7cf0b0', '#c08cf0', '#9ff8ff'], stars: true, weather: 'snow' }),
  palace: sk('#fff6dc', ['#f2d78a', '#ecce7c'], '#d9b85a', '#fff0c9', '#fff6dc', '#b3871f', '#8a2f3f', '#72263a', '#5c1e2e', 'light', { sky: '#ffe8a8', books: ['#8a2f3f', '#e0b94f', '#1f4f7a'], plate: ['#ffe07a', '#e0b94f', '#b3871f'], pot: '#e0b94f', weather: 'confetti' }),
  nebula: sk('#0a0620', ['#1f1448', '#261a55'], '#3a2a7a', '#1a1040', '#22164f', '#ff6bd6', '#3a2a7a', '#2e2166', '#241a52', 'dark', { sky: '#1a0f3a', on: ['#ff6bd6', '#6bd6ff', '#fff06b'], pets: ['#ffb3f0', '#b3e6ff', '#fff6b3'], leaf: ['#6bd6ff', '#ff6bd6'], stars: true, weather: 'star' }),
  // ───── 2026-09-27 추가 40종 (사용자: "양 대폭") ─────
  lemon: sk('#fffbe0', ['#f5e79a', '#efe08e'], '#e0cf73', '#fff6c9', '#fffbe0', '#c9a52e', '#ffffff', '#e8e3cf', '#d3cdb5', 'light', { leaf: ['#7cc48a', '#5aa06a'] }),
  lavender: sk('#f4efff', ['#d9ccf5', '#d2c4f0'], '#bfb0e3', '#ece4ff', '#f6f1ff', '#8f6fd0', '#ffffff', '#e3dcf2', '#cfc6e6', 'light', { leaf: ['#9a7ad6', '#7a5ab6'] }),
  peach: sk('#fff3ec', ['#ffd6c2', '#ffcdb6'], '#f5b89c', '#fff0e8', '#fff6f1', '#e8835a', '#fff6f1', '#f0d8cc', '#e0c2b3', 'light', {}),
  sky: sk('#eef8ff', ['#cfe9fb', '#c6e3f8'], '#aed3ef', '#e6f4ff', '#f3faff', '#5aa0e6', '#ffffff', '#dbe8f2', '#c4d6e6', 'light', { sky: '#9fd8ff' }),
  sand: sk('#f8f1e4', ['#e8d6b2', '#e2cea8'], '#cfb98c', '#f2e6cf', '#f7eedd', '#a8864f', '#c9a77c', '#b08e63', '#957650', 'light', {}),
  concrete: sk('#e4e4e4', ['#b9b9b9', '#b1b1b1'], '#9e9e9e', '#cfcfcf', '#dadada', '#5a5a5a', '#8a8f97', '#747a82', '#61666d', 'light', { books: ['#e8743a', '#3a3a3a', '#9a9a9a'] }),
  coral: sk('#fff0ed', ['#ffb8a8', '#ffae9c'], '#f0967f', '#ffe6e0', '#fff0ec', '#e5604d', '#ffffff', '#f2d6cf', '#e3bfb6', 'light', {}),
  olive: sk('#f1f0e2', ['#b8b87a', '#b0b072'], '#99995e', '#e4e3c8', '#eeedd6', '#6b6b2e', '#d9cfa8', '#c2b88f', '#aaa077', 'light', { leaf: ['#6b8a2e', '#4f6b1f'] }),
  cream: sk('#fffaf0', ['#f3e6cc', '#eee0c3'], '#e0cfae', '#fff5e3', '#fffaf0', '#c9a87c', '#ffffff', '#efe6d3', '#ddd2bb', 'light', {}),
  berry: sk('#eef0fb', ['#aab3e6', '#a2abe0'], '#8a94d0', '#dfe3f8', '#eaedfb', '#4a55a8', '#ffffff', '#dcdff0', '#c6cae3', 'light', { pets: ['#c9d0ff', '#ffc6d9', '#fff1a6'] }),
  snowfield: sk('#f2f7fc', ['#ffffff', '#f3f7fb'], '#dfe8f0', '#dfeaf5', '#eaf2fa', '#7a9ab8', '#c9d6e3', '#aebfd0', '#95a8bc', 'light', { sky: '#cfe4f7', weather: 'snow' }),
  rainforest: sk('#dcefd6', ['#4f7a3a', '#487234'], '#3a5f2b', '#2f5a2a', '#386632', '#1f3a1a', '#8d6a45', '#735638', '#5e452d', 'light', { sky: '#a8e0b8', leaf: ['#2f9a4f', '#1f7a3a'], weather: 'leaf' }),
  subway: sk('#2a2d33', ['#8a8f97', '#83888f'], '#6b7078', '#dfe3e8', '#e8ecf0', '#ffc93c', '#5a6068', '#4a4f56', '#3c4046', 'dark', { sky: '#3a3f47', books: ['#ffc93c', '#5aa0e6', '#e5484d'] }),
  bakery: sk('#fbf1e3', ['#e3c49a', '#dcbc91'], '#c9a57a', '#f6e2c6', '#fbecd6', '#a86e36', '#f2d9b5', '#dcbf98', '#c4a67e', 'light', { books: ['#c98a4a', '#f2d9b5', '#e5484d'], planks: true }),
  arcade: sk('#120a1f', ['#221538', '#281a42'], '#3a2a5a', '#1a1030', '#221640', '#ff4fd8', '#3a2a5a', '#2e2148', '#241a3a', 'dark', { on: ['#39f3ff', '#ff4fd8', '#fff06b'], books: ['#39f3ff', '#ff4fd8', '#b6ff5c'], stars: true }),
  hospital: sk('#f0fbf8', ['#e6f2ef', '#dcece8'], '#c8ded9', '#ffffff', '#f6fbfa', '#3fb89a', '#ffffff', '#e3ecea', '#ccdad6', 'light', { books: ['#3fb89a', '#e5484d', '#5aa0e6'] }),
  study: sk('#f2eee4', ['#a98160', '#a17a59'], '#8c6a4c', '#e6ddc8', '#efe7d4', '#4a6b3f', '#6e4a33', '#5a3c28', '#48301f', 'light', { planks: true }),
  farm: sk('#eef6e0', ['#9fcf6a', '#96c762'], '#7fb04f', '#c9463d', '#d85249', '#7a2a24', '#d9b77c', '#bf9d62', '#a3844f', 'light', { sky: '#bfe8ff', leaf: ['#4f9a3f', '#3a7a2e'] }),
  tea: sk('#f1efe3', ['#8fa36a', '#879b63'], '#72864f', '#e8e2cc', '#f0ebd8', '#4a5a2e', '#6b4a33', '#573b28', '#46301f', 'light', { planks: true }),
  penguin: sk('#eaf4fb', ['#f7fbff', '#eef5fb'], '#d6e5f0', '#bcdcf0', '#cde6f6', '#2a4a66', '#ffffff', '#dbe6f0', '#c3d3e0', 'light', { pets: ['#ffffff', '#2a2f3a', '#ffd27a'], weather: 'snow' }),
  lab: sk('#eefafb', ['#d6eef0', '#cde8eb'], '#b6d9dd', '#f6fcfd', '#ffffff', '#2a9aa8', '#e6f2f4', '#cfe2e5', '#b8d1d5', 'light', { on: ['#39f3ff', '#9ef0a4', '#ffd27a'], books: ['#2a9aa8', '#e5484d', '#ffd27a'] }),
  garage: sk('#e3e0dc', ['#8a8580', '#837e79'], '#6b6661', '#c9c4be', '#d6d1cb', '#e8743a', '#5a5550', '#4a4541', '#3c3835', 'light', { books: ['#e8743a', '#3a3a3a', '#ffc93c'] }),
  bamboo: sk('#e6f3dc', ['#a8c98a', '#a0c182'], '#88aa6c', '#7fae5e', '#8cbb6a', '#3f6b2a', '#c9b37c', '#b09a63', '#96824f', 'light', { leaf: ['#5f9a3f', '#3f7a2a'], weather: 'leaf' }),
  icecream: sk('#fff6fb', ['#ffe0ef', '#ffd6ea'], '#f5c2dc', '#e3f6ff', '#f0fbff', '#ff8ac2', '#fff6c9', '#f0e6b0', '#dcd198', 'light', { pets: ['#fff6e6', '#ffd6e8', '#d6f0ff'], weather: 'confetti' }),
  underwater: sk('#04162a', ['#0e3354', '#0c2e4d'], '#12406a', '#0a2440', '#0e2c4f', '#39f3ff', '#1f4f7a', '#193f63', '#13324f', 'dark', { sky: '#06203a', on: ['#39f3ff', '#9ff8ff', '#b6ff5c'], pets: ['#9ff8ff', '#ffb3c8', '#fff1a6'], stars: true, weather: 'bubble' }),
  steampunk: sk('#2a1f16', ['#6b4a2e', '#634429'], '#553a23', '#4a3622', '#56402a', '#c99a2e', '#8a5a2e', '#734a25', '#5e3c1e', 'dark', { on: ['#ffc93c', '#ff8a3d', '#ffe07a'], books: ['#c99a2e', '#8a5a2e', '#5a3727'], plate: ['#ffe07a', '#c99a2e', '#8a6a1a'], weather: 'ember' }),
  vaporwave: sk('#1a0f33', ['#ff8ad8', '#ff7fd2'], '#e865bc', '#6b3fd0', '#7d4fe0', '#39f3ff', '#39f3ff', '#22d0dc', '#16a8b3', 'dark', { sky: '#ff9ad0', on: ['#39f3ff', '#ff4fd8', '#fff06b'], pets: ['#fff06b', '#9ff8ff', '#ffb3f0'], stars: true }),
  temple: sk('#f4ecdc', ['#b8784a', '#b07043'], '#955c35', '#e9d9b5', '#f2e4c6', '#b3321f', '#8a2f1f', '#72261a', '#5c1e14', 'light', { plate: ['#ffe07a', '#e0b94f', '#b3871f'], books: ['#e0b94f', '#b3321f', '#2f6b3f'], planks: true }),
  moonbase: sk('#06060f', ['#8a8f9a', '#838893'], '#6b707a', '#3a3f4a', '#454b57', '#c9cfe0', '#d9dde3', '#b9bec6', '#9aa0a9', 'dark', { sky: '#02020a', on: ['#39f3ff', '#ffcf4f', '#b6ff5c'], stars: true, weather: 'star' }),
  ninja: sk('#15131a', ['#3a3530', '#34302b'], '#4a443d', '#2a2622', '#322d29', '#b3321f', '#2a2622', '#211e1b', '#1a1715', 'dark', { sky: '#1a1f33', pets: ['#e6e6e6', '#ffb3b3', '#fff1a6'], books: ['#b3321f', '#e6e6e6', '#3a3530'], stars: true, weather: 'petal' }),
  carnival: sk('#fff3e0', ['#e5484d', '#ffffff'], '#f0c2c4', '#ffe0a8', '#ffeac2', '#e5484d', '#5aa0e6', '#4a86c2', '#3a6ea3', 'light', { books: ['#e5484d', '#ffc93c', '#5aa0e6'], weather: 'confetti' }),
  igloo: sk('#e6f2fb', ['#dfeef8', '#d4e7f4'], '#bcd6ea', '#f6fbff', '#ffffff', '#8fb8dc', '#cfe2f2', '#b6cfe4', '#9fbcd6', 'light', { sky: '#1f2f55', stars: true, weather: 'snow' }),
  mushroom: sk('#eef5e2', ['#8fbf6a', '#86b562'], '#6f9e4f', '#e5484d', '#ef5a5f', '#ffffff', '#f6efe0', '#e0d6c2', '#c9bda6', 'light', { pets: ['#fff6e6', '#ffd6e8', '#c9f0c1'], leaf: ['#e5484d', '#c23a3f'], weather: 'leaf' }),
  midnight: sk('#0d1024', ['#2a2f4a', '#262a44'], '#353b5a', '#1a1f3a', '#212747', '#e0b94f', '#3a2a1e', '#2e2118', '#241a12', 'dark', { sky: '#0a0e24', books: ['#8b2f2f', '#2f4f8b', '#2f6b3f', '#8b6b2f'], stars: true }),
  dragon: sk('#1a0808', ['#5a1f14', '#51190f'], '#6b2a1a', '#3a1210', '#451814', '#e0b94f', '#6b2a1a', '#551f12', '#43180e', 'dark', { sky: '#5a0a0a', on: ['#ff5a1f', '#ffc93c', '#ff8a3d'], books: ['#e0b94f', '#ff5a1f', '#8a1f1f'], plate: ['#ffe07a', '#e0b94f', '#b3871f'], weather: 'ember' }),
  crystal: sk('#0f0a24', ['#3a2a6b', '#34245f'], '#4a3a85', '#221845', '#2a1e52', '#9ff8ff', '#6b4fd0', '#5a3fb8', '#4a32a0', 'dark', { sky: '#150f33', on: ['#9ff8ff', '#ff9ae8', '#c9b3ff'], pets: ['#9ff8ff', '#ffb3f0', '#e6d4ff'], leaf: ['#9ff8ff', '#c08cf0'], stars: true, weather: 'star' }),
  heaven: sk('#fffdf2', ['#ffffff', '#fbf8ec'], '#efe8cf', '#fff9e0', '#fffdf2', '#e0b94f', '#fff6d6', '#f0e6bf', '#dfd2a3', 'light', { sky: '#fff3c9', pets: ['#ffffff', '#fff6c9', '#ffe0ec'], plate: ['#ffe07a', '#e0b94f', '#b3871f'], weather: 'star' }),
  blackhole: sk('#000000', ['#0e0a1a', '#120d20'], '#1f1733', '#07050f', '#0b0816', '#c08cf0', '#1f1733', '#18122a', '#120d20', 'dark', { sky: '#000000', on: ['#c08cf0', '#ff9a3c', '#9ff8ff'], pets: ['#e6d4ff', '#ffd19e', '#9ff8ff'], stars: true, weather: 'star' }),
  rainbowland: sk('#fff8ff', ['#ffd6d6', '#fff0c9'], '#d6ffd9', '#d6ecff', '#ecdcff', '#ff8ac2', '#ffffff', '#f0e6f6', '#e0d0ec', 'light', { sky: '#cfeaff', pets: ['#ffd6d6', '#fff0c9', '#d6ffd9', '#d6ecff', '#ecdcff'], books: ['#e5484d', '#ff9a3c', '#ffd27a', '#7cc48a', '#5aa0e6', '#c08cf0'], weather: 'confetti' }),
  goldmine: sk('#1a140a', ['#5a4526', '#523f22'], '#6b5530', '#3a2e1c', '#453622', '#ffc93c', '#8a6a3a', '#735830', '#5e4826', 'dark', { on: ['#ffc93c', '#ffe07a', '#ff8a3d'], books: ['#ffc93c', '#e0b94f', '#b3871f'], plate: ['#ffe07a', '#ffc93c', '#c99a2e'], weather: 'ember' }),
  cloud: sk('#e8f4ff', ['#ffffff', '#f4f9ff'], '#dcecfb', '#eaf5ff', '#f6fbff', '#9ab8dc', '#ffffff', '#e4eefa', '#cddcf0', 'light', { sky: '#bfe0ff', pets: ['#fff1a6', '#ffc6d9', '#c9f0c1', '#e6d4ff'], books: ['#9ab8dc', '#ffc6d9', '#fff1a6'], leaf: ['#9ad9b0', '#7cc49a'], pot: '#ffffff', weather: 'star' }),
};

/** 새 스킨 만들기 — 바닥·벽·책상 색만 주면 나머지는 기본(나무)에서. o 로 덮어쓴다 */
function sk(bg: string, floor: [string, string], grain: string, wallL: string, wallR: string, wallTop: string, deskTop: string, deskL: string, deskR: string, label: Skin['label'], o: Partial<Skin> = {}): Skin {
  const base: Skin = {
    bg, floor, grain, wallL, wallR, wallTop, deskTop, deskL, deskR, mon: '#2e2a30', monR: '#3b3742', screen: '#1c2838',
    on: ['#7fd1ff', '#ffd27a', '#9ef0a4'], line: label === 'dark' ? '#07070f' : '#2a1c14', pets: ['#ffd9a8', '#bfe3ff', '#c9f0c1', '#ffc6d9', '#e6d4ff', '#fff1a6'],
    pat: deskTop, leaf: ['#4d9a57', '#35743f'], pot: deskL, sky: '#bfe5ff', frame: wallTop, shelf: deskL, books: ['#d9786b', '#6ea6d9', '#e0b94f', '#7cc48a'],
    cooler: '#f4f4f4', water: '#8fd0ff', paper: '#ffffff', label,
  };
  return { ...base, ...o };
}

/** 고르는 순서·이름 (사무실 왼쪽 위 글자 버튼) */
export const SKIN_NAMES: [string, string][] = [
  ['wood', tr('나무', 'Wood')], ['mint', tr('민트', 'Mint')], ['camp', tr('캠핑장', 'Campsite')], ['library', tr('도서관', 'Library')], ['cafe', tr('카페', 'Cafe')], ['classroom', tr('교실', 'Classroom')], ['greenhouse', tr('온실', 'Greenhouse')], ['mono', tr('흑백', 'Monochrome')],
  ['sakura', tr('벚꽃', 'Cherry Blossom')], ['beach', tr('해변', 'Beach')], ['cabin', tr('눈 오두막', 'Snowy Cabin')], ['forest', tr('숲속', 'Forest')], ['candy', tr('사탕나라', 'Candyland')], ['hanok', tr('한옥', 'Hanok House')], ['gameboy', tr('게임보이', 'Retro Handheld')],
  ['lcd', tr('LCD', 'LCD')], ['neon', tr('네온', 'Neon')], ['ocean', tr('바닷속', 'Under the Sea')], ['cyber', tr('사이버펑크', 'Cyberpunk')], ['halloween', tr('할로윈', 'Halloween')], ['christmas', tr('크리스마스', 'Christmas')], ['desert', tr('사막', 'Desert')], ['dungeon', tr('지하 던전', 'Dungeon')],
  ['space', tr('우주정거장', 'Space Station')], ['volcano', tr('화산', 'Volcano')], ['cloud', tr('구름 위', 'Above the Clouds')],
  ['matcha', tr('녹차', 'Matcha')], ['choco', tr('초콜릿', 'Chocolate')], ['strawberry', tr('딸기', 'Strawberry')], ['pastel', tr('파스텔', 'Pastel')],
  ['autumn', tr('가을 단풍', 'Autumn Leaves')], ['jungle', tr('정글', 'Jungle')], ['retro', tr('레트로 80', 'Retro 80s')], ['lighthouse', tr('등대', 'Lighthouse')], ['rainycity', tr('비 오는 도시', 'Rainy City')],
  ['pirate', tr('해적선', 'Pirate Ship')], ['sakuranight', tr('밤벚꽃', 'Night Blossoms')], ['aurora', tr('오로라 설원', 'Aurora Tundra')], ['palace', tr('황금 궁전', 'Golden Palace')], ['nebula', tr('성운 정원', 'Nebula Garden')],
  ['lemon', tr('레몬', 'Lemon')], ['lavender', tr('라벤더', 'Lavender')], ['peach', tr('복숭아', 'Peach')], ['sky', tr('하늘', 'Sky')], ['sand', tr('모래', 'Sand')], ['concrete', tr('콘크리트', 'Concrete')],
  ['coral', tr('산호', 'Coral')], ['olive', tr('올리브', 'Olive')], ['cream', tr('크림', 'Cream')], ['berry', tr('블루베리', 'Blueberry')], ['snowfield', tr('설원', 'Snowfield')], ['rainforest', tr('열대우림', 'Rainforest')],
  ['subway', tr('지하철', 'Subway')], ['bakery', tr('빵집', 'Bakery')], ['arcade', tr('오락실', 'Arcade')], ['hospital', tr('병원', 'Hospital')], ['study', tr('공부방', 'Study Room')], ['farm', tr('농장', 'Farm')],
  ['tea', tr('찻집', 'Tea House')], ['penguin', tr('남극', 'Antarctica')], ['lab', tr('연구실', 'Lab')], ['garage', tr('차고', 'Garage')], ['bamboo', tr('대나무 숲', 'Bamboo Grove')], ['icecream', tr('아이스크림', 'Ice Cream')],
  ['underwater', tr('심해', 'Deep Sea')], ['steampunk', tr('스팀펑크', 'Steampunk')], ['vaporwave', tr('베이퍼웨이브', 'Vaporwave')], ['temple', tr('사찰', 'Temple')], ['moonbase', tr('달 기지', 'Moon Base')], ['ninja', tr('닌자 저택', 'Ninja Manor')],
  ['carnival', tr('카니발', 'Carnival')], ['igloo', tr('이글루', 'Igloo')], ['mushroom', tr('버섯 마을', 'Mushroom Village')], ['midnight', tr('한밤 도서관', 'Midnight Library')], ['dragon', tr('용의 둥지', "Dragon's Nest")], ['crystal', tr('수정 동굴', 'Crystal Cave')],
  ['heaven', tr('천국 계단', 'Stairway to Heaven')], ['blackhole', tr('블랙홀', 'Black Hole')], ['rainbowland', tr('무지개 나라', 'Rainbow Land')], ['goldmine', tr('금광', 'Gold Mine')],
];

export const DEFAULT_SKIN = 'wood';
/** 처음부터 가진 스킨 — 나머지는 머지 가챠로 연다(사용자: 미리 다 열어주지 말 것) */
export const STARTER_SKINS = ['wood'];
export const skinOf = (name: string | undefined): Skin => SKINS[name ?? DEFAULT_SKIN] ?? SKINS[DEFAULT_SKIN]!;
