import Button from '@/ui/Button'
import Switch from '@/ui/Switch'
import { t } from '@/utils/i18n'

import { Card, Row, SectionHeader } from '@/features/options/layout'

import CustomModeDialog from './CustomModeDialog'
import DeleteModeDialog from './DeleteModeDialog'
import ModeSelector from './ModeSelector'
import ProxyServerFields from './ProxyServerFields'
import RuleListSection from './RuleListSection'
import ScenarioRulesSection from './ScenarioRulesSection'
import { useNetworkController } from './useNetworkController'
import WebrtcSettings from './WebrtcSettings'

/**
 * 设置页「网络」：网络模式、自定义代理模式、代理服务器、绕过列表与自动模式规则的完整配置，
 * 以及与代理配合使用的 WebRTC 防泄露
 */
export default function NetworkSettings() {
  const c = useNetworkController({ withPageContext: false })

  // 有未保存的代理配置时，关闭或刷新设置页前提醒
  useEffect(() => {
    if (!c.profileDirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [c.profileDirty])

  return (
    <div className='flex flex-col gap-5'>
      <SectionHeader title={t('network.settings.title')} desc={t('network.settings.desc')} />

      <Card
        title={t('network.settings.modeTitle')}
        extra={
          <Button
            onClick={c.openCustomModeDialog}
            disabled={c.busy}
            className='!px-2.5 !py-1 text-xs'
          >
            {t('network.settings.addCustomMode')}
          </Button>
        }
      >
        <ModeSelector
          mode={c.mode}
          customModes={c.customProxyModes}
          activeCustomModeId={c.activeCustomProxyModeId}
          customModeActive={Boolean(c.activeCustomProxyMode)}
          disabled={c.busy}
          onSelectMode={c.applyMode}
          onSelectCustomMode={c.selectCustomProxyMode}
        />
        {c.statusText && (
          <p className={`text-xs ${c.status?.ok ? 'text-neutral-500' : 'text-rose-500'}`}>
            {c.statusText}
          </p>
        )}
        <Row
          label={t('network.settings.reloadOnSwitch')}
          hint={t('network.settings.reloadOnSwitchHint')}
        >
          <Switch checked={c.reloadOnSwitch} onChange={c.toggleReloadOnSwitch} />
        </Row>
      </Card>

      {c.showProxySettings ? (
        <Card
          title={t('network.settings.proxyConfig')}
          desc={c.proxyConfigDescription}
          extra={
            c.activeCustomProxyMode && (
              <Button
                disabled={c.busy}
                onClick={() =>
                  c.activeCustomProxyMode && c.openCustomModeDeleteDialog(c.activeCustomProxyMode)
                }
                className='!px-2.5 !py-1 text-xs !text-rose-600'
              >
                {t('network.settings.deleteMode')}
              </Button>
            )
          }
        >
          <div>
            <h3 className='mb-1.5 text-sm font-medium text-neutral-700'>
              {t('network.settings.proxyServer')}
            </h3>
            <ProxyServerFields profile={c.profile} onChange={c.setProfile} />
          </div>

          {c.showRuleListSettings && (
            <div className='border-t border-neutral-100 pt-3'>
              <RuleListSection syncProxyIfActive={c.syncProxyIfActive} />
              <ScenarioRulesSection
                currentHost=''
                disabled={c.busy}
                onHostProxied={() => undefined}
                syncProxyIfActive={c.syncProxyIfActive}
              />
            </div>
          )}

          <div className='border-t border-neutral-100 pt-3'>
            <h3 className='mb-1.5 text-sm font-medium text-neutral-700'>
              {t('network.settings.bypassTitle')}
            </h3>
            <textarea
              value={c.bypassText}
              rows={8}
              spellCheck={false}
              onChange={(event) => c.setBypassText(event.target.value)}
              placeholder={'<local>\n127.0.0.1\n*.dev.local'}
              className='w-full resize-y rounded-lg border border-neutral-300 bg-white px-3 py-2 font-mono text-xs leading-5 text-neutral-700 placeholder:text-neutral-400 outline-none transition-colors focus:border-accent-500'
            />
            <p className='mt-1.5 text-xs leading-relaxed text-neutral-500'>
              {t('network.settings.bypassHint')}
            </p>
          </div>

          {/* 吸底：表单很长时保存按钮始终可见；有未保存的改动时高亮提示 */}
          <div
            className={`sticky bottom-3 z-10 -mx-2 flex items-center justify-between gap-3 rounded-lg border px-3 py-2 transition-colors ${
              c.profileDirty
                ? 'border-amber-300 bg-amber-50 shadow-md'
                : 'border-neutral-100 bg-white/95 backdrop-blur'
            }`}
          >
            <p
              className={`min-w-0 flex-1 truncate text-xs ${
                c.customModeError
                  ? 'text-rose-500'
                  : c.profileDirty
                    ? 'font-medium text-amber-700'
                    : 'text-neutral-500'
              }`}
            >
              {c.profileDirty
                ? t('network.settings.unsaved')
                : c.customModeStatus || t('network.settings.saveHint')}
            </p>
            {c.canSaveProxyProfile && (
              <Button variant='primary' onClick={c.saveProxyProfile} loading={c.busy}>
                {c.saveProxyLabel}
              </Button>
            )}
          </div>
        </Card>
      ) : (
        <Card title={t('network.settings.proxyConfig')} desc={t('network.settings.noConfigDesc')}>
          <span className='text-xs text-neutral-500'>{t('network.settings.noConfig')}</span>
        </Card>
      )}

      <WebrtcSettings />

      {c.customModeOpen && (
        <CustomModeDialog
          name={c.customModeName}
          profile={c.customModeProfile}
          status={c.customModeStatus}
          error={c.customModeError}
          busy={c.busy}
          onNameChange={(name) => {
            c.setCustomModeName(name)
            c.setCustomModeStatus('')
            c.setCustomModeError(false)
          }}
          onProfileChange={c.setCustomModeProfile}
          onClose={c.closeCustomModeDialog}
          onSave={c.createCustomProxyMode}
        />
      )}

      {c.customModeDeleteTarget && (
        <DeleteModeDialog
          name={c.customModeDeleteTarget.name}
          error={c.customModeError ? c.customModeStatus : ''}
          busy={c.busy}
          onClose={c.closeCustomModeDeleteDialog}
          onConfirm={c.confirmDeleteCustomMode}
        />
      )}
    </div>
  )
}
