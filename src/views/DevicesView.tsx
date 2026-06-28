// 文件路径：src/views/DevicesView.tsx
// 文件作用：设备管理视图——设备列表表格 + 空状态引导
// 最后更新时间：2026-06-28-1230

import type { DeviceInfo } from '../types';
import { Button, Badge } from '../components/ui';
import { EmptyState } from '../components/EmptyState';

interface DevicesViewProps {
  devices: DeviceInfo[];
  loading?: boolean;
  onRefresh: () => void;
  onGoDevelop: () => void;
}

export function DevicesView({ devices, loading, onRefresh, onGoDevelop }: DevicesViewProps) {
  return (
    <div className="devices-view ui-card">
      <div className="view-header">
        <h3>设备列表</h3>
        <Button variant="secondary" size="sm" onClick={onRefresh} disabled={loading}>
          {loading ? '扫描中…' : '刷新设备列表'}
        </Button>
      </div>

      {devices.length === 0 ? (
        <EmptyState
          icon="🔌"
          title="未检测到设备"
          description="请连接 ESP32 开发板后刷新设备列表。若设备已连接但仍未识别，可能是 CH343/CP210x 驱动未安装。"
          actions={[
            { label: '刷新设备', onClick: onRefresh },
            { label: '返回开发', onClick: onGoDevelop },
          ]}
        />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>端口</th><th>芯片</th><th>MAC</th><th>Flash</th>
              <th>VID</th><th>PID</th><th>产品</th><th>状态</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.port}>
                <td><strong>{d.port}</strong></td>
                <td>{d.chip ?? '-'}</td>
                <td className="mono">{d.mac ?? '-'}</td>
                <td>{d.flash_size ?? '-'}</td>
                <td className="mono">{d.vid ? `0x${d.vid.toString(16)}` : '-'}</td>
                <td className="mono">{d.pid ? `0x${d.pid.toString(16)}` : '-'}</td>
                <td>{d.product ?? '-'}</td>
                <td>
                  {d.detected ? (
                    <Badge tone="success">已识别</Badge>
                  ) : (
                    <Badge tone="warning">未识别</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
