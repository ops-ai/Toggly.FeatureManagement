import { Injectable } from '@angular/core'
import { ITogglyOptions } from './models'

@Injectable({
  providedIn: 'root',
})
export class TogglyOptions implements ITogglyOptions {
  baseURI?: string
  appKey?: string
  environment?: string
  identity?: string
  featureDefaults?: { [key: string]: boolean }
  showFeatureDuringEvaluation?: boolean
  customDefinitionsUrl?: string
}
