/**
 * Zustand store for prompt templates management.
 */

import { create } from 'zustand';

import type { PromptTemplate } from '../../../../preload/index';

type PromptTemplatesState = {
  templates: PromptTemplate[];
  activeTemplateId: string;
  isInitialized: boolean;
  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  createTemplate: (input: {
    name: string;
    systemPrompt?: string;
    outputStructure?: string;
    cloneFromId?: string;
  }) => Promise<PromptTemplate | null>;
  updateTemplate: (input: {
    id: string;
    name?: string;
    systemPrompt?: string;
    outputStructure?: string;
  }) => Promise<boolean>;
  deleteTemplate: (id: string) => Promise<boolean>;
  setActiveTemplate: (id: string) => Promise<boolean>;
};

export const usePromptTemplatesStore = create<PromptTemplatesState>((set, get) => ({
  templates: [],
  activeTemplateId: '',
  isInitialized: false,

  initialize: async () => {
    if (get().isInitialized) return;
    const [templates, activeId] = await Promise.all([
      window.api.promptTemplates.list(),
      window.api.promptTemplates.getActive(),
    ]);
    set({ templates, activeTemplateId: activeId, isInitialized: true });
  },

  refresh: async () => {
    const [templates, activeId] = await Promise.all([
      window.api.promptTemplates.list(),
      window.api.promptTemplates.getActive(),
    ]);
    set({ templates, activeTemplateId: activeId });
  },

  createTemplate: async (input) => {
    const result = await window.api.promptTemplates.create(input);
    if (result.success && result.template) {
      await get().refresh();
      return result.template;
    }
    return null;
  },

  updateTemplate: async (input) => {
    const result = await window.api.promptTemplates.update(input);
    if (result.success) {
      await get().refresh();
      return true;
    }
    return false;
  },

  deleteTemplate: async (id) => {
    const result = await window.api.promptTemplates.delete(id);
    if (result.success) {
      await get().refresh();
      return true;
    }
    return false;
  },

  setActiveTemplate: async (id) => {
    const result = await window.api.promptTemplates.setActive(id);
    if (result.success) {
      set({ activeTemplateId: id });
      return true;
    }
    return false;
  },
}));
