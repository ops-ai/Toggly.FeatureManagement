import { ReactNode } from 'react';
import { TogglyOptions } from '../../services';
export default function createTogglyProvider(config: TogglyOptions): Promise<({ children }: {
    children: ReactNode;
}) => JSX.Element>;
