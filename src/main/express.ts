/*
 * Copyright (c) 2025 Xibo Signage Ltd
 *
 * Xibo - Digital Signage - https://xibosignage.com
 *
 * This file is part of Xibo.
 *
 * Xibo is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 *
 * Xibo is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Xibo.  If not, see <http://www.gnu.org/licenses/>.
 */
import express from 'express';
import corsImport from 'cors';
import fs from 'fs/promises';
import fsSync from 'fs';
import { BrowserWindow, app } from 'electron';
import { DateTime } from 'luxon';

import { Config } from './config/config';
import { Faults } from '../shared/faults/Faults';
import { scheduleCriteriaManager } from '../shared/scheduleCriteria/scheduleCriteriaManager';

const cors = (corsImport as any).default ?? corsImport;
const port = 9696;
let isListening = false;

export async function createFileServer(config: Config, mainWindow: BrowserWindow, faults: Faults) {
  const server = express();
  // Use the cors middleware
  server.use(cors());

  // Parse JSON request bodies
  server.use(express.json());

  const xiboLibDir = config.getSetting('library');

  // Ensure the library path exists
  if (!fsSync.existsSync(xiboLibDir)) {
    await fs.mkdir(xiboLibDir, { recursive: true });
  }

  server.get('/', (_req, res) => {
    res.send('Hello World!');
  });

  // Optional: list all files if /files/ is accessed directly
  server.get('/files', (_req, res) => {
    const files = fsSync.readdirSync(xiboLibDir);
    res.json({
      files,
      count: files.length,
      message: 'Use /files/<filename> to access individual files',
    });
  });

  server.use('/files', express.static(xiboLibDir));

  // ─── Local Player API ────────────────────────────────────────────────────────

  server.get('/info', (_req, res) => {
    res.json({
      version: app.getVersion(),
      displayName: config.displayName ?? '',
      hardwareKey: config.hardwareKey ?? '',
      screenWidth: config.state.width,
      screenHeight: config.state.height,
      longitude: config.state.longitude ?? 0,
      latitude: config.state.latitude ?? 0,
      timeZone: config.state.timeZone ?? '',
      currentLayoutId: config.state.currentLayoutId,
      displayStatus: config.state.displayStatus,
    });
  });

  server.post('/trigger', (req, res) => {
    const { trigger, id } = req.body ?? {};
    if (!trigger) {
      res.status(400).json({ success: false, error: 'trigger is required' });
      return;
    }
    const payload: { triggerCode: string; widgetId?: string } = { triggerCode: trigger, widgetId: undefined };
    if (id != null) payload.widgetId = String(id);
    mainWindow.webContents.send('trigger-webhook', payload);
    res.json({ success: true });
  });

  server.post('/duration/expire', (req, res) => {
    const { id } = req.body ?? {};
    if (id == null) {
      res.status(400).json({ success: false, error: 'id is required' });
      return;
    }
    mainWindow.webContents.send('xlr-expire-widget', String(id));
    res.json({ success: true });
  });

  server.post('/duration/extend', (req, res) => {
    const { id, duration } = req.body ?? {};
    if (id == null || duration == null) {
      res.status(400).json({ success: false, error: 'id and duration are required' });
      return;
    }
    mainWindow.webContents.send('xlr-extend-widget-duration', String(id), Number(duration));
    res.json({ success: true });
  });

  server.post('/duration/set', (req, res) => {
    const { id, duration } = req.body ?? {};
    if (id == null || duration == null) {
      res.status(400).json({ success: false, error: 'id and duration are required' });
      return;
    }
    mainWindow.webContents.send('xlr-set-widget-duration', String(id), Number(duration));
    res.json({ success: true });
  });

  server.get('/realtime', (req, res) => {
    const { dataKey } = req.query;
    if (!dataKey) {
      res.status(400).json({ success: false, error: 'dataKey is required' });
      return;
    }
    res.status(200).send();
  });

  server.post('/setCriteria', (req, res) => {
    const { criteriaUpdates } = req.body ?? {};
    if (!Array.isArray(criteriaUpdates)) {
      res.status(400).json({ success: false, error: 'criteriaUpdates must be an array' });
      return;
    }

    let updated = 0;
    for (const entry of criteriaUpdates) {
      const { metric, value, ttl } = entry ?? {};
      if (!metric || value == null) {
        res.status(400).json({ success: false, error: 'metric and value are required' });
        return;
      }
      scheduleCriteriaManager.addOrReplace(metric, value, ttl ?? 300);
      updated++;
    }

    res.json({ success: true, updated });
  });

  server.post('/fault', (req, res) => {
    const ip = req.ip ?? '';
    if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }

    const { code, key, reason, ttl } = req.body ?? {};
    if (code == null || !key || !reason || ttl == null) {
      res.status(400).json({ success: false, error: 'code, key, reason and ttl are required' });
      return;
    }

    const expires = DateTime.now().plus({ seconds: Number(ttl) }).toFormat('yyyy-MM-dd HH:mm:ss');
    const faultData: any = { code: Number(code), reason, expires };

    if (String(key).includes('_')) {
      const parts = String(key).split('_');
      const widgetId = parseInt(parts[1], 10);
      if (!isNaN(widgetId)) {
        faultData.widgetId = widgetId;
      }
    }

    faults.emitter.emit('message', faultData);
    res.json({ success: true });
  });

  if (!isListening) {
    server.listen(port, () => {
      isListening = true;
      console.log(`Xibo File Server listening on port ${port}`);
    });
  }
}
