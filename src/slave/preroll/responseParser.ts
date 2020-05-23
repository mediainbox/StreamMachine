import {AdData} from "./AdInstance";
import * as xml2js from 'xml2js';

export function parseAdResponse(data: string): Promise<AdData> {
  return parseXMLResponse(data);
}

function parseXMLResponse(data: string): Promise<AdData> {
  if (!data.startsWith('<?xml')) {
    throw new Error('Invalid XML input received for ad');
  }

  const parser = new xml2js.Parser({explicitArray: true, trim: true});

  return parser
    .parseStringPromise(data)
    .then((parsedXml: any) => {
      const wrapper = parsedXml.VAST || parsedXml.DAAST;

      if (!wrapper) {
        throw new Error('Could not found VAST or DAAST wrapper in XML');
      }

      try {
        const inline = wrapper.Ad[0].InLine[0];

        return {
          creativeUrl: inline.Creatives[0].Creative[0].Linear[0].MediaFiles[0].MediaFile[0]._,
          impressionUrl: inline.Impression[0]._,
        }
      } catch (err) {
        throw new Error('Could not get media file path in XML');
      }
    });
}
