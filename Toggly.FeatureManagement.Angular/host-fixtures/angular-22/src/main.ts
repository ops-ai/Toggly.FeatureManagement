import { bootstrapApplication } from '@angular/platform-browser';
import { provideZonelessChangeDetection } from '@angular/core';
import { AppComponent, providers } from './host';
bootstrapApplication(AppComponent, { providers: [provideZonelessChangeDetection(), ...providers] }).then(app => { (window as unknown as { destroyHost: () => void }).destroyHost = () => app.destroy(); }).catch(console.error);
