import type { Action } from './api'

interface ActionStyle {
  chip: string
  bar: string
  dot: string
  text: string
  meaning: string
}

export const ACTION_STYLE: Record<Action, ActionStyle> = {
  ALLOW: {
    chip: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/30',
    bar: 'bg-emerald-400',
    dot: 'bg-emerald-400',
    text: 'text-emerald-300',
    meaning: 'forwarded unchanged',
  },
  REDACT: {
    chip: 'bg-sky-500/15 text-sky-300 ring-sky-400/30',
    bar: 'bg-sky-400',
    dot: 'bg-sky-400',
    text: 'text-sky-300',
    meaning: 'placeholders to the cloud',
  },
  REROUTE: {
    chip: 'bg-violet-500/15 text-violet-300 ring-violet-400/30',
    bar: 'bg-violet-400',
    dot: 'bg-violet-400',
    text: 'text-violet-300',
    meaning: 'kept on the local model',
  },
  HOLD: {
    chip: 'bg-amber-500/15 text-amber-300 ring-amber-400/30',
    bar: 'bg-amber-400',
    dot: 'bg-amber-400',
    text: 'text-amber-300',
    meaning: 'waited for a human',
  },
  BLOCK: {
    chip: 'bg-red-500/15 text-red-300 ring-red-400/40',
    bar: 'bg-red-500',
    dot: 'bg-red-500',
    text: 'text-red-300',
    meaning: 'refused',
  },
}

export const TIER_NAME = ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'] as const
