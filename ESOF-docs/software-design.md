# Relatório 3 - Design de Software

## Índice
1. [Introdução à Arquitetura de Software e ao Modelo de Arquitetura 4 + 1](#introducao)
1. [Vista Lógica](#logica)
1. [Vista de Desenvolvimento](#desenvolvimento)
1. [Vista de Distribuição](#deployment)
1. [Vista de Processo](#processo)

## Introdução à Arquitetura de Software e ao Modelo de Arquitetura 4 + 1

O *uBlock Origin*, através da utilização das várias tecnologias *web* usadas atualmente, implementa o Padrão Model-View-Controller.

A parte *View* do programa é implementado utilizando *HTML* e *CSS*, que permite moldar a embelezar a parte visual da extensão. Para os *Controller* e *Model* é utilizado *JavaScript* dando a possibilidade de editar as páginas dinamicamente e separando a lógica da interface.

## Vista Lógica

O *uBlock Origin* apresenta-se com os seguintes pacotes, de modo a organizar o código de maneira lógica:

![Diagrama da Vista Lógica](logical-view.png)


O programa baseia-se no *redirect engine*, que é o motor que decide que conteúdos serão ou não apresentados. Para isto, é necessário um mecanismo de filtragem de *scripts* considerados malignos ou indesejados.

Este mecanismo precisa de saber que *URLs* bloquear. Como tal, são necessárias regras que, dependendo se estão ou não na *whitelist* ou *blacklist*, permitirão ou bloquearão a transferências de conteúdo de *websites*. De modo a criar uma aplicação personalizável, além das regras estáticas, existem as regras dinâmicas, que permitem bloquear certos *downloads* indesejados, com base nas condições fornecidas pelo utilizador.

A possibilidade do utilizador inserir regras próprias cria um problema de transformar a informação introduzida em informação utilizável pelo computador. Com o intuito de resolver esse problema, o criador do projeto criou um *parser* de *URLs* que permite a criação de regras.

A interface do programa é representada pelo pacote *dashboard* que é o código que permite ao utilizador interagir com o *uBlock*. Esta extensão deve funcionar com vários navegadores de *internet* diferentes. Como tal, existe um pacote *platform* que permite o projeto correr nos vários *browser*.

## Vista de Desenvolvimento

## Vista de Distribuição

## Vista de Processo
Para percebermos melhor as interações dos processos do sistema de acordo com as ações que são pedidas/realizadas, foi criado um diagrama de forma a percebermos melhor a esta interação.
![Diagrama da Vista Lógica](process-view.png)
Como podemos verificar pelo diagrama, inicialmente, encontrando-se na interface do *uBlock* pode-se tomar três decisões diferentes.

Na situação do painel de controlo, existem várias atividades possíveis de se realizar, desde as definições,à gestão de filtros e à lista branca. Na situação das definições, o programa guarda as alterações que o utilizador está a indicar, e à recebida do *input* para a realização das alterações este atualiza as definições fazendo de seguida uma nova sincronização do DOM (*Document Object Model*) quando é realizado o *load* da página, sendo que este è feito de seguida ao *input* para as alterações. Quando è realizado a adição ou remoção de um filtro, o programa ou adiciona, fazendo a leitura do ficheiro com os filtros novos e aplica as alterações ou revertendo as alterações no caso de remoção de filtros. Relativamente à lista branca (local onde são indicados os servidores para os quais o uBlock será desativado), quando é dado o *input* para a adição, è retirado em *string* os servidores indicados e aplicadas as alterações.

Quando é indicado a atividade de selecionar elementos, dependendo daquilo que o utilizador indica que deseja filtrar, podendo ser a nível cosmético (imagens, por exemplo) ou de rede. Em ambas as situações, o programa procura inicialmente a posição do que foi selecionado, sendo que se foi a nível cosmético, é necessário mapear a área da página novamente. O resto do processo de remoção, dá-se como nas outras situações em que são aplicados filtros.

No caso de registo de pedidos, onde é possível inspecionar os pedidos de rede e os elementos do *DOM*, quer sejam bloqueados ou permitidos, assim como o filtro que atua nesse momento. O programa gere por ordem de chegada a amostra linha a linha de cada acontecimento do *uBlock*, sendo que indica em cada linha (em casos de bloqueio, permissão ou oculta algum elemento) o filtro correspondente, o tipo de filtragem que foi realizado (imagem,*script*,*dom*) e o local (*URL*). Esta informação é toda antes fornecida, tendo apenas o programa de estar atento a algum *input* do utilizador a pedir para limpar a lista atual com os registos ou para recomeçar a listagem novamente do *uBlock*.
