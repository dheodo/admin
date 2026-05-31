/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Project {
  id: string;
  title: string;
  subtitle: string;
  category: string;
  image: string;
  description?: string;
  location: string;
  year: string;
  aspectRatio: string;
  isFeatured: boolean;
  showInCarousel?: boolean;
  createdAt: any;
  galleryImages?: string[];
}

export type CategoryType = 'Residential' | 'Commercial' | 'Renovation' | 'Kitchen & Bath' | 'Office Design' | 'Retail' | 'Millwork' | 'Other';

export const CATEGORIES: CategoryType[] = [
  'Residential',
  'Commercial',
  'Renovation',
  'Kitchen & Bath',
  'Office Design',
  'Retail',
  'Millwork',
  'Other'
];

export interface ProjectFormData {
  name: string;      // maps to title on save
  subtitle: string;
  category: string;
  imageUrl: string;  // maps to image on save
  detail?: string;    // maps to description on save
  location: string;
  year: string;
  galleryImages: string[];
  isFeatured: boolean;
  showInCarousel: boolean;
}
