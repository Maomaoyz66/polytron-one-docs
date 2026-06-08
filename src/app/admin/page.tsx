import type { Metadata } from 'next';
import { AdminEditor } from './admin-editor';

export const metadata: Metadata = {
  title: 'Admin - POLYTRON ONE Documentation',
  robots: {
    index: false,
    follow: false,
  },
};

export default function AdminPage() {
  return <AdminEditor />;
}
