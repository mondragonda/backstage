FROM node:18

WORKDIR /backstage

COPY package* .

RUN yarn install

COPY . .

CMD ["yarn", "start-backend"]