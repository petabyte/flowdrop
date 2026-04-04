import {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  NodeOperationError,
} from 'n8n-workflow';

export class FlowDrop implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'FlowDrop',
    name: 'flowDrop',
    icon: 'file:flowdrop.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: 'Upload, manage, and retrieve files via FlowDrop',
    defaults: {
      name: 'FlowDrop',
    },
    inputs: ['main'],
    outputs: ['main'],
    credentials: [
      {
        name: 'flowDropApi',
        required: true,
      },
    ],
    properties: [
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        options: [
          {
            name: 'Upload File',
            value: 'uploadFile',
            description: 'Upload a file and get a public CDN URL',
            action: 'Upload a file',
          },
          {
            name: 'Delete File',
            value: 'deleteFile',
            description: 'Delete a file by its R2 key',
            action: 'Delete a file',
          },
          {
            name: 'List Files',
            value: 'listFiles',
            description: 'List uploaded files with optional pagination and tier filter',
            action: 'List files',
          },
          {
            name: 'Get File Info',
            value: 'getFileInfo',
            description: 'Get metadata for a specific file by key',
            action: 'Get file info',
          },
        ],
        default: 'uploadFile',
      },

      // ─── Upload File fields ───────────────────────────────────────────────
      {
        displayName: 'Binary Property',
        name: 'binaryPropertyName',
        type: 'string',
        default: 'data',
        required: true,
        displayOptions: { show: { operation: ['uploadFile'] } },
        description: 'Name of the binary property containing the file to upload',
      },
      {
        displayName: 'Filename Override',
        name: 'filename',
        type: 'string',
        default: '',
        displayOptions: { show: { operation: ['uploadFile'] } },
        description: 'Optional: override the filename. Leave empty to use the original name.',
      },

      // ─── Delete File fields ───────────────────────────────────────────────
      {
        displayName: 'File Key',
        name: 'fileKey',
        type: 'string',
        default: '',
        required: true,
        displayOptions: { show: { operation: ['deleteFile'] } },
        description: 'The R2 object key of the file to delete (e.g. abc123.jpg)',
      },

      // ─── List Files fields ────────────────────────────────────────────────
      {
        displayName: 'Limit',
        name: 'limit',
        type: 'number',
        default: 20,
        typeOptions: { minValue: 1, maxValue: 100 },
        displayOptions: { show: { operation: ['listFiles'] } },
        description: 'Maximum number of files to return (max 100)',
      },
      {
        displayName: 'Offset',
        name: 'offset',
        type: 'number',
        default: 0,
        typeOptions: { minValue: 0 },
        displayOptions: { show: { operation: ['listFiles'] } },
        description: 'Number of files to skip (for pagination)',
      },
      {
        displayName: 'Tier Filter',
        name: 'tier',
        type: 'options',
        default: '',
        displayOptions: { show: { operation: ['listFiles'] } },
        options: [
          { name: 'All', value: '' },
          { name: 'Free', value: 'free' },
          { name: 'Starter', value: 'starter' },
          { name: 'Pro', value: 'pro' },
        ],
        description: 'Filter results by subscription tier',
      },

      // ─── Get File Info fields ─────────────────────────────────────────────
      {
        displayName: 'File Key',
        name: 'fileKey',
        type: 'string',
        default: '',
        required: true,
        displayOptions: { show: { operation: ['getFileInfo'] } },
        description: 'The R2 object key of the file (e.g. abc123.jpg)',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];
    const credentials = await this.getCredentials('flowDropApi');
    const baseUrl = (credentials.baseUrl as string).replace(/\/$/, '');
    const operation = this.getNodeParameter('operation', 0) as string;

    for (let i = 0; i < items.length; i++) {
      try {
        if (operation === 'uploadFile') {
          const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
          const filenameOverride = this.getNodeParameter('filename', i) as string;

          const binaryData = this.helpers.assertBinaryData(i, binaryPropertyName);
          const buffer = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);

          const filename = filenameOverride || binaryData.fileName || 'upload';

          const formData = new FormData();
          formData.append('file', new Blob([buffer], { type: binaryData.mimeType }), filename);

          const response = await this.helpers.httpRequest({
            method: 'POST',
            url: `${baseUrl}/api/upload`,
            headers: { 'x-api-key': credentials.apiKey as string },
            body: formData,
          });

          for (const file of response.files as IDataObject[]) {
            returnData.push({ json: file });
          }
        }

        else if (operation === 'deleteFile') {
          const fileKey = this.getNodeParameter('fileKey', i) as string;

          const response = await this.helpers.httpRequest({
            method: 'DELETE',
            url: `${baseUrl}/api/files/${encodeURIComponent(fileKey)}`,
            headers: { 'x-api-key': credentials.apiKey as string },
          });

          returnData.push({ json: response as IDataObject });
        }

        else if (operation === 'listFiles') {
          const limit = this.getNodeParameter('limit', i) as number;
          const offset = this.getNodeParameter('offset', i) as number;
          const tier = this.getNodeParameter('tier', i) as string;

          const qs: Record<string, string | number> = { limit, offset };
          if (tier) qs.tier = tier;

          const response = await this.helpers.httpRequest({
            method: 'GET',
            url: `${baseUrl}/api/files`,
            headers: { 'x-api-key': credentials.apiKey as string },
            qs,
          });

          for (const file of response.files as IDataObject[]) {
            returnData.push({ json: file });
          }
        }

        else if (operation === 'getFileInfo') {
          const fileKey = this.getNodeParameter('fileKey', i) as string;

          const response = await this.helpers.httpRequest({
            method: 'GET',
            url: `${baseUrl}/api/files`,
            headers: { 'x-api-key': credentials.apiKey as string },
            qs: { limit: 100, offset: 0 },
          });

          const file = (response.files as IDataObject[])
            .find((f) => f.key === fileKey);

          if (!file) {
            throw new NodeOperationError(
              this.getNode(),
              `File with key "${fileKey}" not found.`,
              { itemIndex: i }
            );
          }

          returnData.push({ json: file });
        }

      } catch (error) {
        if (this.continueOnFail()) {
          returnData.push({ json: { error: (error as Error).message }, pairedItem: i });
          continue;
        }
        throw error;
      }
    }

    return [returnData];
  }
}
