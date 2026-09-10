import { Section } from '../types';

export interface SampleCatalog {
  name: string;
  description: string;
  defaultCredits: number;
  sections: Section[];
}

export const SAMPLE_CATALOGS: SampleCatalog[] = [];
