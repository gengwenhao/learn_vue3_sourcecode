import {
  type ComponentInternalInstance,
  currentInstance,
  isInSSRComponentSetup,
  setCurrentInstance
} from './component'
import type { ComponentPublicInstance } from './componentPublicInstance'
import { ErrorTypeStrings, callWithAsyncErrorHandling } from './errorHandling'
import { warn } from './warning'
import { toHandlerKey } from '@vue/shared'
import {
  type DebuggerEvent,
  pauseTracking,
  resetTracking
} from '@vue/reactivity'
import { LifecycleHooks } from './enums'

export { onActivated, onDeactivated } from './components/KeepAlive'

// geng: injectHook 函数的作用是向组件实例的 hooks 数组中插入一个 hook
// geng: hook 是组件实例的生命周期钩子函数
// geng: target 为组件实例，默认会指向 currentInstance 也就是当前组件实例
// geng: prepend 参数表示是否在 hooks 的头部插入 hook
export function injectHook(
  type: LifecycleHooks,
  hook: Function & { __weh?: Function },
  target: ComponentInternalInstance | null = currentInstance,
  prepend: boolean = false
): Function | undefined {
  if (target) {
    // geng: hooks 是一个数组，里面存放着组件实例的生命周期钩子函数
    // geng: 它其实被直接保存在了组件实例上
    // geng: 比如 mounted 生命周期钩子函数的 type 为 m，所以它被保存在了 target.m 中
    // geng: 比如 activated 生命周期钩子函数的 type 为 a，所以它被保存在了 target.a 中
    const hooks = target[type] || (target[type] = [])
    // cache the error handling wrapper for injected hooks so the same hook
    // can be properly deduped by the scheduler. "__weh" stands for "with error
    // handling".

    // geng: 为啥要搞这个？
    // geng: 因为 injectHook 函数会被调用很多次
    // geng： 它把绑定的 hook 上挂载了一个 __weh 属性
    // geng: 第一次调用 injectHook 时，__weh 属性不存在，
    // geng: 第二次调用 injectHook 时，__weh 属性已经存在，
    // geng: 直接返回 __weh 属性，起到了缓存的作用，防止绑定多次同一个回调做了性能优化
    const wrappedHook =
      hook.__weh ||
      (hook.__weh = (...args: unknown[]) => {
        if (target.isUnmounted) {
          return
        }

        // geng: hook 内部访问的响应式对象其实已经执行过依赖收集了
        // geng: 所以这里执行 pauseTracking 函数，暂停依赖收集
        // geng: 执行完 hook 函数后，恢复依赖收集
        // disable tracking inside all lifecycle hooks
        // since they can potentially be called inside effects.
        pauseTracking()
        // Set currentInstance during hook invocation.
        // This assumes the hook does not synchronously trigger other hooks, which
        // can only be false when the user does something really funky.
        const reset = setCurrentInstance(target)
        const res = callWithAsyncErrorHandling(hook, target, type, args)
        reset()
        resetTracking()
        return res
      })

    // geng: prepend 的处理很简单，就是将 hook 函数插入到 hooks 的头部
    if (prepend) {
      hooks.unshift(wrappedHook)
    } else {
      hooks.push(wrappedHook)
    }
    return wrappedHook
  } else if (__DEV__) {
    // geng: Vue 挂载一个组件时（执行 setup 函数之前），会把组件实例挂载到 currentInstance 上，
    // geng: 如果 target 为 null，说明 injectHook 的函数调用不是在 setup 函数中
    // geng: 如果 __DEV__ 成立，说明是开发环境，则打印警告
    const apiName = toHandlerKey(ErrorTypeStrings[type].replace(/ hook$/, ''))
    warn(
      `${apiName} is called when there is no active component instance to be ` +
      `associated with. ` +
      `Lifecycle injection APIs can only be used during execution of setup().` +
      (__FEATURE_SUSPENSE__
        ? ` If you are using async setup(), make sure to register lifecycle ` +
        `hooks before the first await statement.`
        : ``)
    )
  }
}

// geng: 这是一种函数柯里化的写法，返回一个函数，这个函数接收一个参数
export const createHook =
  <T extends Function = () => any>(lifecycle: LifecycleHooks) =>
    (hook: T, target: ComponentInternalInstance | null = currentInstance) =>
      // post-create lifecycle registrations are noops during SSR (except for serverPrefetch)
      (!isInSSRComponentSetup || lifecycle === LifecycleHooks.SERVER_PREFETCH) &&
      injectHook(lifecycle, (...args: unknown[]) => hook(...args), target)

export const onBeforeMount = createHook(LifecycleHooks.BEFORE_MOUNT)
export const onMounted = createHook(LifecycleHooks.MOUNTED)
export const onBeforeUpdate = createHook(LifecycleHooks.BEFORE_UPDATE)
export const onUpdated = createHook(LifecycleHooks.UPDATED)
export const onBeforeUnmount = createHook(LifecycleHooks.BEFORE_UNMOUNT)
export const onUnmounted = createHook(LifecycleHooks.UNMOUNTED)
export const onServerPrefetch = createHook(LifecycleHooks.SERVER_PREFETCH)

export type DebuggerHook = (e: DebuggerEvent) => void
export const onRenderTriggered = createHook<DebuggerHook>(
  LifecycleHooks.RENDER_TRIGGERED
)
export const onRenderTracked = createHook<DebuggerHook>(
  LifecycleHooks.RENDER_TRACKED
)

export type ErrorCapturedHook<TError = unknown> = (
  err: TError,
  instance: ComponentPublicInstance | null,
  info: string
) => boolean | void

export function onErrorCaptured<TError = Error>(
  hook: ErrorCapturedHook<TError>,
  target: ComponentInternalInstance | null = currentInstance
) {
  injectHook(LifecycleHooks.ERROR_CAPTURED, hook, target)
}
