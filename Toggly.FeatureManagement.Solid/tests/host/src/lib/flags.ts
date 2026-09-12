import { query } from '@solidjs/router';
export const getFlags=query(async (identity:string)=>{
  'use server';
  const { requestFlags }=await import('./flags.server');
  return requestFlags(identity);
},'toggly-flags');
