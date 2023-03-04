/// <reference types="react" />
import { TogglyService } from '../services';
interface TogglyContext {
    toggly?: TogglyService;
}
declare const context: import("react").Context<TogglyContext>;
declare const Provider: import("react").Provider<TogglyContext>, Consumer: import("react").Consumer<TogglyContext>;
export { context, Provider, Consumer, TogglyContext };
