import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent, providers } from './host.spec';
bootstrapApplication(AppComponent, { providers: [...providers] }).then(app => { (window as unknown as { destroyHost: () => void }).destroyHost = () => app.destroy(); }).catch(console.error);
