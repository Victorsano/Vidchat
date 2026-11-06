import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata={title:'Dorcas match — A little closer.',description:'One shared video room. No accounts. Just people.'};
export default function Layout({children}:{children:React.ReactNode}) {return <html lang="en"><body>{children}</body></html>}
